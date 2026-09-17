import {
  chunkSegments,
  extractKeyStatements,
  formatTimestamp,
  type ChunkSegment,
  type KeyStatement,
  type TranscriptSegment,
} from '@unipods/ai';
import { setMeetingChunkEmbeddings } from '@unipods/database';
import type { PrismaClient } from '@unipods/database';
import type { MeetingSummaryPayload } from '@unipods/types';
import { withHeader } from './context-header';
import { describeFailure } from './failure';
import { noopLogger, type IngestDeps, type PipelineResult } from './deps';

interface MeetingChunkMetadata extends Record<string, unknown> {
  source: 'meeting';
  startTime: number;
  endTime: number;
  speaker?: string;
}

/** A PROCESSING claim older than this is treated as abandoned. */
const STALE_CLAIM_MS = 15 * 60 * 1000;

/** A transcript chunk covers at most this much of the recording. */
const MAX_CHUNK_SPAN_SECONDS = 180;
/** A pause longer than this ends a chunk: the conversation moved on. */
const SILENCE_BREAK_SECONDS = 90;
const MEETING_TARGET_TOKENS = 220;

export class MeetingProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeetingProcessingError';
  }
}

/**
 * Transcribes the uploaded media (when a transcription provider is configured)
 * and stores the timestamped transcript. Meetings that already carry an
 * imported transcript skip straight to summarising and indexing.
 */
export async function transcribeMeeting(deps: IngestDeps, meetingId: string): Promise<void> {
  const { prisma, storage, transcription } = deps;
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) throw new MeetingProcessingError('Meeting no longer exists.');

  const existing = await prisma.meetingTranscript.count({ where: { meetingId } });
  if (existing > 0) return;

  if (!meeting.storageKey) {
    throw new MeetingProcessingError(
      'This meeting has no recording and no transcript. Upload a recording, or import a .vtt/.srt/.json transcript.',
    );
  }
  if (!transcription?.available) {
    throw new MeetingProcessingError(
      'Speech-to-text is not configured. Set AI_PROVIDER=openai with OPENAI_API_KEY, or import an existing transcript for this meeting.',
    );
  }

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { status: 'PROCESSING', statusMessage: 'Transcribing the recording…' },
  });

  const media = await storage.download(meeting.storageKey);
  const result = await transcription.transcribe(
    media,
    meeting.originalFileName ?? 'recording',
    meeting.mimeType ? { mimeType: meeting.mimeType } : {},
  );

  await saveTranscript(prisma, meetingId, result.segments, result.durationSeconds);
}

/**
 * Replaces a meeting's transcript with the supplied segments.
 *
 * Takes the client rather than the whole dependency bundle: importing a
 * transcript needs no AI provider, and the API calls this directly so a
 * malformed file is reported to the uploader immediately.
 */
export async function saveTranscript(
  prisma: PrismaClient,
  meetingId: string,
  segments: TranscriptSegment[],
  durationSeconds: number | null,
): Promise<number> {
  const usable = segments.filter((segment) => segment.content.trim().length > 0);
  if (usable.length === 0) {
    throw new MeetingProcessingError('The transcript contained no speech.');
  }

  await prisma.$transaction([
    prisma.meetingTranscript.deleteMany({ where: { meetingId } }),
    prisma.meetingTranscript.createMany({
      data: usable.map((segment, index) => ({
        meetingId,
        speaker: segment.speaker,
        content: segment.content.trim(),
        startTime: segment.startTime,
        endTime: Math.max(segment.endTime, segment.startTime),
        sequence: index,
        metadata: {},
      })),
    }),
    prisma.meeting.update({
      where: { id: meetingId },
      data: {
        durationSeconds:
          durationSeconds !== null
            ? Math.round(durationSeconds)
            : Math.round(usable[usable.length - 1]?.endTime ?? 0),
      },
    }),
  ]);

  return usable.length;
}

/**
 * Summarises the transcript, then chunks and embeds it.
 *
 * The generated summary is stored alongside — never instead of — the
 * transcript, so every claim in a summary can be checked against the segment
 * it came from.
 */
export async function processMeeting(deps: IngestDeps, meetingId: string): Promise<PipelineResult> {
  const { prisma, embeddings, llm } = deps;
  const logger = deps.logger ?? noopLogger;

  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) {
    return { ok: false, chunks: 0, embedded: 0, message: 'Meeting no longer exists.' };
  }

  try {
    // Same claim as documents: concurrent runs would collide on
    // (meetingId, chunkIndex). See document.pipeline.ts.
    const claimed = await prisma.meeting.updateMany({
      where: {
        id: meetingId,
        OR: [
          { status: { not: 'PROCESSING' } },
          { updatedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) } },
        ],
      },
      data: { status: 'PROCESSING', statusMessage: 'Summarising and indexing…' },
    });
    if (claimed.count === 0) {
      logger.info('meeting already being processed', { meetingId });
      return {
        ok: true,
        chunks: 0,
        embedded: 0,
        message: 'Another processor is already working on this meeting.',
      };
    }

    const transcript = await prisma.meetingTranscript.findMany({
      where: { meetingId },
      orderBy: { sequence: 'asc' },
    });
    if (transcript.length === 0) {
      throw new MeetingProcessingError(
        'This meeting has no transcript yet. Transcribe the recording or import a transcript first.',
      );
    }

    const summary: MeetingSummaryPayload = await llm.generateSummary({
      title: meeting.title,
      date: meeting.meetingDate.toISOString(),
      durationSeconds: meeting.durationSeconds,
      segments: transcript.map((segment) => ({
        speaker: segment.speaker,
        content: segment.content,
        startTime: segment.startTime,
        endTime: segment.endTime,
      })),
    });

    const segments: Array<ChunkSegment<MeetingChunkMetadata>> = transcript.map((segment) => ({
      // Prefixing the speaker keeps attribution inside the embedded text, so
      // "what did Amara say about X" can actually retrieve.
      text: segment.speaker ? `${segment.speaker}: ${segment.content}` : segment.content,
      metadata: {
        source: 'meeting',
        startTime: segment.startTime,
        endTime: segment.endTime,
        ...(segment.speaker ? { speaker: segment.speaker } : {}),
      },
    }));

    const chunks = chunkSegments(segments, {
      // Transcripts are chunked tighter than prose: a citation that says 32:15
      // has to land on the moment being cited, and a chunk spanning twenty
      // minutes cannot do that.
      targetTokens: Math.min(deps.chunking?.targetTokens ?? MEETING_TARGET_TOKENS, MEETING_TARGET_TOKENS),
      overlapTokens: Math.min(deps.chunking?.overlapTokens ?? 40, 60),
      minTokens: 30,
      breakBetween: (chunkStart, next) =>
        next.startTime - chunkStart.startTime > MAX_CHUNK_SPAN_SECONDS ||
        next.startTime - Number(chunkStart.endTime ?? chunkStart.startTime) > SILENCE_BREAK_SECONDS,
    });

    // A meeting's decisions and commitments are what people search for, and
    // they are scattered across the call. Collecting them into one chunk —
    // verbatim, never paraphrased — makes "what did we decide about X"
    // retrievable without relying on the exact wording used in the moment.
    const keyStatements = extractKeyStatements(
      transcript.map((segment) => ({
        speaker: segment.speaker,
        content: segment.content,
        startTime: segment.startTime,
        endTime: segment.endTime,
      })),
    );
    const digest = buildDigestChunk(meeting.title, keyStatements);

    await prisma.$transaction([
      prisma.meetingChunk.deleteMany({ where: { meetingId } }),
      prisma.meetingChunk.createMany({
        data: chunks.map((chunk) => ({
          meetingId,
          // Contextual header, so a passage from the middle of a call still
          // says which meeting and which moment it came from.
          content: withHeader(
            [meeting.title, formatTimestamp(Number(chunk.metadata.startTime ?? 0))],
            chunk.content,
          ),
          chunkIndex: chunk.chunkIndex,
          tokenCount: chunk.tokenCount,
          startTime: Number(chunk.metadata.startTime ?? 0),
          endTime: Number(chunk.metadata.endTime ?? chunk.metadata.startTime ?? 0),
          metadata: {
            ...chunk.metadata,
            chunkIndex: chunk.chunkIndex,
            timestamp: formatTimestamp(Number(chunk.metadata.startTime ?? 0)),
          },
        })),
      }),
    ]);

    if (digest) {
      await prisma.meetingChunk.create({
        data: {
          meetingId,
          content: digest.content,
          chunkIndex: chunks.length,
          tokenCount: Math.ceil(digest.content.length / 4),
          startTime: digest.startTime,
          endTime: digest.endTime,
          metadata: {
            source: 'meeting',
            kind: 'key-statements',
            startTime: digest.startTime,
            endTime: digest.endTime,
            chunkIndex: chunks.length,
            timestamp: formatTimestamp(digest.startTime),
            statements: keyStatements.length,
          },
        },
      });
    }

    const stored = await prisma.meetingChunk.findMany({
      where: { meetingId },
      orderBy: { chunkIndex: 'asc' },
      select: { id: true, content: true },
    });

    const vectors = await embeddings.embedTexts(stored.map((chunk) => chunk.content));
    const embedded = await setMeetingChunkEmbeddings(
      prisma,
      stored.map((chunk, index) => ({ id: chunk.id, embedding: vectors[index] as number[] })),
    );

    await prisma.meeting.update({
      where: { id: meetingId },
      data: { status: 'COMPLETED', statusMessage: null, summary: summary as object },
    });

    await prisma.source.upsert({
      where: { type_referenceId: { type: 'MEETING', referenceId: meetingId } },
      create: {
        type: 'MEETING',
        title: meeting.title,
        referenceId: meetingId,
        meetingId,
        occurredAt: meeting.meetingDate,
        metadata: { durationSeconds: meeting.durationSeconds, segments: transcript.length },
      },
      update: {
        title: meeting.title,
        occurredAt: meeting.meetingDate,
        metadata: { durationSeconds: meeting.durationSeconds, segments: transcript.length },
      },
    });

    const totalChunks = chunks.length + (digest ? 1 : 0);
    logger.info('meeting processed', { meetingId, chunks: totalChunks, embedded });
    return { ok: true, chunks: totalChunks, embedded };
  } catch (error) {
    const { userMessage, logDetail } = describeFailure(error);
    logger.error('meeting processing failed', { meetingId, reason: logDetail });
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { status: 'FAILED', statusMessage: userMessage.slice(0, 500) },
    });
    return { ok: false, chunks: 0, embedded: 0, message: userMessage };
  }
}


/**
 * Builds the verbatim decisions-and-actions chunk for a meeting.
 *
 * Every line is a sentence copied out of the transcript, grouped under plain
 * headings. Nothing here is generated, so citing it cites the transcript.
 */
function buildDigestChunk(
  title: string,
  statements: KeyStatement[],
): { content: string; startTime: number; endTime: number } | null {
  if (statements.length === 0) return null;

  const groups: Array<[KeyStatement['kind'], string]> = [
    ['decision', 'Decisions'],
    ['action', 'Action items'],
    ['deadline', 'Deadlines'],
    ['question', 'Open questions'],
  ];

  const lines: string[] = [];
  for (const [kind, heading] of groups) {
    const matching = statements.filter((statement) => statement.kind === kind);
    if (matching.length === 0) continue;
    lines.push(`${heading}:`);
    for (const statement of matching.slice(0, 12)) {
      const who = statement.speaker ? `${statement.speaker}: ` : '';
      lines.push(`- [${formatTimestamp(statement.startTime)}] ${who}${statement.text}`);
    }
  }
  if (lines.length === 0) return null;

  const times = statements.map((statement) => statement.startTime);
  return {
    content: withHeader([title, 'decisions and action items'], lines.join('\n')),
    startTime: Math.min(...times),
    endTime: Math.max(...times),
  };
}
