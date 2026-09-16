import { DEFAULT_JOB_OPTIONS, JOB_NAMES, QUEUE_NAMES } from '@unipods/config';
import {
  processDocument,
  processMeeting,
  processMessages,
  transcribeMeeting,
} from '@unipods/ingest';
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { createWorkerContext } from './context';

/**
 * Background worker.
 *
 * Everything expensive — text extraction, embedding, speech-to-text,
 * summarising — happens here rather than inside an HTTP request. Each queue gets
 * a concurrency suited to what it does: embedding is network-bound and fine to
 * parallelise, transcription is expensive and deliberately serialised.
 */
async function main(): Promise<void> {
  const context = createWorkerContext();
  const { env, logger, deps, prisma } = context;

  const connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  connection.on('error', (error) => logger.warn('redis error', { reason: error.message }));

  const workers: Worker[] = [];

  const register = <T extends object>(
    queue: string,
    concurrency: number,
    handler: (job: Job<T>) => Promise<unknown>,
  ) => {
    const worker = new Worker<T>(queue, handler, {
      connection,
      concurrency,
      // Jobs are retried with exponential backoff; see DEFAULT_JOB_OPTIONS.
      autorun: true,
    });
    worker.on('failed', (job, error) => {
      logger.error('job failed', {
        queue,
        jobId: job?.id,
        attempt: job?.attemptsMade,
        reason: error?.message,
      });
    });
    worker.on('completed', (job) => {
      logger.info('job completed', { queue, jobId: job.id, job: job.name });
    });
    workers.push(worker as Worker);
    return worker;
  };

  register<{ documentId: string }>(QUEUE_NAMES.DOCUMENT_PROCESSING, 3, async (job) => {
    const result = await processDocument(deps, job.data.documentId);
    // A failed pipeline already recorded *why* on the document row. Throwing
    // here lets BullMQ retry, and the final failure is visible in the UI.
    if (!result.ok) throw new Error(result.message ?? 'Document processing failed.');
    return result;
  });

  register<{ meetingId: string }>(QUEUE_NAMES.MEETING_TRANSCRIPTION, 1, async (job) => {
    // Transcribe, then summarise and index in the same job: re-queuing would
    // risk summarising a meeting whose transcript write has not landed yet.
    await transcribeMeeting(deps, job.data.meetingId);
    const result = await processMeeting(deps, job.data.meetingId);
    if (!result.ok) throw new Error(result.message ?? 'Meeting processing failed.');
    return result;
  });

  register<{ meetingId: string }>(QUEUE_NAMES.MEETING_SUMMARY, 2, async (job) => {
    const result = await processMeeting(deps, job.data.meetingId);
    if (!result.ok) throw new Error(result.message ?? 'Meeting processing failed.');
    return result;
  });

  register<{ messageIds: string[] }>(QUEUE_NAMES.MESSAGE_PROCESSING, 2, async (job) => {
    const result = await processMessages(deps, job.data.messageIds);
    if (!result.ok) throw new Error(result.message ?? 'Message processing failed.');
    return result;
  });

  // Re-embeds anything left without a vector, e.g. after an AI outage.
  register<{ scope?: 'documents' | 'meetings' | 'messages' }>(
    QUEUE_NAMES.EMBEDDING,
    2,
    async (job) => {
      const scope = job.data.scope ?? 'documents';
      if (scope === 'documents') {
        const rows = await prisma.$queryRaw<Array<{ documentId: string }>>`
          SELECT DISTINCT "documentId" FROM "document_chunks" WHERE "embedding" IS NULL LIMIT 20
        `;
        for (const row of rows) await processDocument(deps, row.documentId);
        return { reprocessed: rows.length };
      }
      if (scope === 'meetings') {
        const rows = await prisma.$queryRaw<Array<{ meetingId: string }>>`
          SELECT DISTINCT "meetingId" FROM "meeting_chunks" WHERE "embedding" IS NULL LIMIT 20
        `;
        for (const row of rows) await processMeeting(deps, row.meetingId);
        return { reprocessed: rows.length };
      }
      const rows = await prisma.$queryRaw<Array<{ messageId: string }>>`
        SELECT DISTINCT "messageId" FROM "message_chunks" WHERE "embedding" IS NULL LIMIT 200
      `;
      await processMessages(
        deps,
        rows.map((row) => row.messageId),
      );
      return { reprocessed: rows.length };
    },
  );

  logger.info('worker started', {
    queues: Object.values(QUEUE_NAMES),
    ai: env.AI_PROVIDER,
    storage: env.STORAGE_DRIVER,
    attempts: DEFAULT_JOB_OPTIONS.attempts,
    jobs: Object.values(JOB_NAMES).length,
  });

  const shutdown = async (signal: string) => {
    logger.info('shutting down', { signal });
    await Promise.allSettled(workers.map((worker) => worker.close()));
    await prisma.$disconnect();
    connection.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      level: 'fatal',
      time: new Date().toISOString(),
      msg: 'worker failed to start',
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exit(1);
});
