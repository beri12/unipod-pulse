import { Inject, Injectable } from '@nestjs/common';
import { TranscriptionService, TranscriptParseError } from '@unipods/ai';
import { JOB_NAMES, QUEUE_NAMES, type Env } from '@unipods/config';
import { saveTranscript } from '@unipods/ingest';
import type {
  MeetingDetail,
  MeetingDto,
  MeetingSummaryPayload,
  Paginated,
  ProcessingStatus,
} from '@unipods/types';
import { AppException, ERROR_CODES } from '../common/errors';
import {
  decodeTextUpload,
  validateUpload,
  type UploadedFile,
} from '../common/file-validation';
import { StructuredLogger } from '../common/logger';
import { ENV } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { SourcesService } from '../sources/sources.service';
import { StorageService } from '../storage/storage.service';
import type { CreateMeetingDto, ListMeetingsQueryDto } from './dto/meetings.dto';

const MEDIA_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.mp4', '.webm', '.mov'] as const;
const MEDIA_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/webm',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'application/octet-stream',
] as const;

const TRANSCRIPT_EXTENSIONS = ['.vtt', '.srt', '.json', '.txt'] as const;
const TRANSCRIPT_MIME_TYPES = [
  'text/vtt',
  'text/plain',
  'application/json',
  'application/x-subrip',
  'application/octet-stream',
] as const;

@Injectable()
export class MeetingsService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queues: QueueService,
    private readonly sources: SourcesService,
    private readonly transcription: TranscriptionService,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * Creates a meeting, optionally with a recording.
   *
   * A meeting can also be created without media and given a transcript
   * afterwards — most communities already have one from their conferencing
   * tool, and that path needs no speech-to-text provider at all.
   */
  async create(
    userId: string,
    file: UploadedFile | undefined,
    dto: CreateMeetingDto,
  ): Promise<MeetingDto> {
    let storageKey: string | null = null;
    let mimeType: string | null = null;
    let fileSize: number | null = null;
    let originalFileName: string | null = null;

    if (file) {
      const validated = validateUpload(file, {
        mimeTypes: MEDIA_MIME_TYPES,
        extensions: MEDIA_EXTENSIONS,
        maxBytes: this.env.MAX_FILE_SIZE,
        label: 'recording',
      });
      const stored = await this.storage.upload(
        'meetings',
        validated.originalname,
        validated.buffer,
        validated.mimetype,
      );
      storageKey = stored.key;
      mimeType = validated.mimetype;
      fileSize = validated.size;
      originalFileName = validated.originalname;
    }

    const meeting = await this.prisma.meeting.create({
      data: {
        title: dto.title.trim().slice(0, 300),
        description: dto.description?.trim() || null,
        meetingDate: new Date(dto.meetingDate),
        storageKey,
        mimeType,
        fileSize,
        originalFileName,
        status: 'PENDING',
        statusMessage: storageKey
          ? 'Queued for transcription…'
          : 'Waiting for a transcript. Upload one with POST /api/meetings/:id/transcript.',
        isDemo: this.env.DEMO_MODE,
        createdById: userId,
      },
      include: meetingInclude,
    });

    await this.sources.upsert({
      type: 'MEETING',
      title: meeting.title,
      referenceId: meeting.id,
      meetingId: meeting.id,
      occurredAt: meeting.meetingDate,
      metadata: {},
    });

    if (storageKey) {
      await this.enqueueTranscription(meeting.id);
    }

    this.logger.event('log', 'meeting created', { meetingId: meeting.id, hasMedia: !!storageKey });
    return toMeetingDto(meeting);
  }

  /**
   * Imports an existing transcript (WebVTT, SubRip, JSON or timestamped text),
   * then queues summarising and indexing.
   */
  async importTranscript(meetingId: string, file: UploadedFile | undefined): Promise<MeetingDto> {
    await this.requireMeeting(meetingId);
    const validated = validateUpload(file, {
      mimeTypes: TRANSCRIPT_MIME_TYPES,
      extensions: TRANSCRIPT_EXTENSIONS,
      // Transcripts are text; a 25 MB one would be an outlier already.
      maxBytes: Math.min(this.env.MAX_FILE_SIZE, 25 * 1024 * 1024),
      label: 'transcript',
    });

    const content = decodeTextUpload(validated);
    let segments;
    try {
      segments = this.transcription.parseTranscriptFile(validated.originalname, content);
    } catch (error) {
      if (error instanceof TranscriptParseError) {
        throw AppException.badRequest(error.message, ERROR_CODES.MEETING_PROCESSING_FAILED);
      }
      throw error;
    }

    await saveTranscript(this.prisma, meetingId, segments.segments, segments.durationSeconds);
    await this.enqueueProcessing(meetingId);

    const meeting = await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { status: 'PENDING', statusMessage: 'Transcript imported. Queued for summarising…' },
      include: meetingInclude,
    });
    this.logger.event('log', 'transcript imported', {
      meetingId,
      segments: segments.segments.length,
    });
    return toMeetingDto(meeting);
  }

  async enqueueTranscription(meetingId: string): Promise<void> {
    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { status: 'PENDING', statusMessage: 'Queued for transcription…' },
    });
    await this.queues.enqueue(
      QUEUE_NAMES.MEETING_TRANSCRIPTION,
      JOB_NAMES.MEETING_TRANSCRIBE,
      { meetingId },
      { jobId: `meeting-transcribe-${meetingId}` },
    );
  }

  async enqueueProcessing(meetingId: string): Promise<void> {
    await this.queues.enqueue(
      QUEUE_NAMES.MEETING_SUMMARY,
      JOB_NAMES.MEETING_PROCESS,
      { meetingId },
      { jobId: `meeting-process-${meetingId}` },
    );
  }

  /** Re-runs the pipeline from wherever the meeting currently is. */
  async reprocess(meetingId: string): Promise<MeetingDto> {
    const meeting = await this.requireMeeting(meetingId);
    const transcriptCount = await this.prisma.meetingTranscript.count({ where: { meetingId } });

    if (transcriptCount === 0) {
      if (!meeting.storageKey) {
        throw AppException.badRequest(
          'This meeting has neither a recording nor a transcript. Upload one first.',
          ERROR_CODES.MEETING_PROCESSING_FAILED,
        );
      }
      await this.enqueueTranscription(meetingId);
    } else {
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: { status: 'PENDING', statusMessage: 'Queued for summarising…' },
      });
      await this.enqueueProcessing(meetingId);
    }

    const updated = await this.prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      include: meetingInclude,
    });
    return toMeetingDto(updated);
  }

  async list(query: ListMeetingsQueryDto): Promise<Paginated<MeetingDto>> {
    const where = {
      ...this.demoScope(),
      ...(query.status ? { status: query.status as ProcessingStatus } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' as const } },
              { description: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.meeting.findMany({
        where,
        orderBy: { meetingDate: 'desc' },
        skip: query.skip,
        take: query.limit,
        include: meetingInclude,
      }),
      this.prisma.meeting.count({ where }),
    ]);

    return {
      items: rows.map(toMeetingDto),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async byId(id: string): Promise<MeetingDetail> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id },
      include: {
        ...meetingInclude,
        transcripts: { orderBy: { sequence: 'asc' } },
      },
    });
    if (!meeting) throw AppException.notFound('That meeting');

    return {
      ...toMeetingDto(meeting),
      summary: (meeting.summary as MeetingSummaryPayload | null) ?? null,
      transcript: meeting.transcripts.map((segment) => ({
        id: segment.id,
        speaker: segment.speaker,
        content: segment.content,
        startTime: segment.startTime,
        endTime: segment.endTime,
        sequence: segment.sequence,
      })),
      mediaUrl: meeting.storageKey ? await this.storage.signedUrl(meeting.storageKey) : null,
    };
  }

  async remove(id: string): Promise<void> {
    const meeting = await this.requireMeeting(id);
    if (meeting.storageKey) await this.storage.delete(meeting.storageKey);
    await this.prisma.meeting.delete({ where: { id } });
    this.logger.event('log', 'meeting deleted', { meetingId: id });
  }

  private async requireMeeting(id: string) {
    const meeting = await this.prisma.meeting.findUnique({ where: { id } });
    if (!meeting) throw AppException.notFound('That meeting');
    return meeting;
  }

  private demoScope(): { isDemo?: boolean } {
    return this.env.DEMO_MODE ? { isDemo: true } : { isDemo: false };
  }
}

const meetingInclude = {
  createdBy: { select: { id: true, name: true } },
  _count: { select: { transcripts: true, chunks: true } },
} as const;

type MeetingRow = {
  id: string;
  title: string;
  description: string | null;
  meetingDate: Date;
  durationSeconds: number | null;
  status: ProcessingStatus;
  statusMessage: string | null;
  summary: unknown;
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: { id: string; name: string } | null;
  _count: { transcripts: number; chunks: number };
};

export function toMeetingDto(meeting: MeetingRow): MeetingDto {
  return {
    id: meeting.id,
    title: meeting.title,
    description: meeting.description,
    meetingDate: meeting.meetingDate.toISOString(),
    durationSeconds: meeting.durationSeconds,
    status: meeting.status,
    statusMessage: meeting.statusMessage,
    hasSummary: meeting.summary !== null && meeting.summary !== undefined,
    transcriptSegments: meeting._count.transcripts,
    chunkCount: meeting._count.chunks,
    isDemo: meeting.isDemo,
    createdAt: meeting.createdAt.toISOString(),
    updatedAt: meeting.updatedAt.toISOString(),
    createdBy: meeting.createdBy,
  };
}
