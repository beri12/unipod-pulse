import { chunkSegments, formatTimestamp, type ChunkSegment, type TranscriptSegment } from '@unipods/ai';
import { setMeetingChunkEmbeddings } from '@unipods/database';
import type { PrismaClient } from '@unipods/database';
import type { MeetingSummaryPayload } from '@unipods/types';
import { noopLogger, type IngestDeps, type PipelineResult } from './deps';

interface MeetingChunkMetadata extends Record<string, unknown> {
  source: 'meeting';
  startTime: number;
  endTime: number;
  speaker?: string;
}

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
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { status: 'PROCESSING', statusMessage: 'Summarising and indexing…' },
    });

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

    const chunks = chunkSegments(segments, deps.chunking);

    await prisma.$transaction([
      prisma.meetingChunk.deleteMany({ where: { meetingId } }),
      prisma.meetingChunk.createMany({
        data: chunks.map((chunk) => ({
          meetingId,
          content: chunk.content,
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

    logger.info('meeting processed', { meetingId, chunks: chunks.length, embedded });
    return { ok: true, chunks: chunks.length, embedded };
  } catch (error) {
    const message = (error as Error).message;
    logger.error('meeting processing failed', { meetingId, reason: message });
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { status: 'FAILED', statusMessage: message.slice(0, 500) },
    });
    return { ok: false, chunks: 0, embedded: 0, message };
  }
}
