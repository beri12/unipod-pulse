import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createAiBundle } from '@unipods/ai';
import { loadEnv, type Env } from '@unipods/config';
import { createPrismaClient, type PrismaClient } from '@unipods/database';
import type { IngestDeps, ObjectStore, PipelineLogger } from '@unipods/ingest';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

/**
 * Structured logger, matching the API's line format so both processes can be
 * shipped to the same log store. Credentials are never logged.
 */
export function createLogger(env: Env): PipelineLogger & { fatal: PipelineLogger['error'] } {
  const json = env.NODE_ENV === 'production';
  const write = (level: string, message: string, fields?: Record<string, unknown>) => {
    const payload = { level, time: new Date().toISOString(), msg: message, ...(fields ?? {}) };
    const stream = level === 'error' || level === 'fatal' ? process.stderr : process.stdout;
    stream.write(
      json
        ? `${JSON.stringify(payload)}\n`
        : `${payload.time} ${level.toUpperCase().padEnd(5)} [worker] ${message}${
            fields ? ` ${JSON.stringify(fields)}` : ''
          }\n`,
    );
  };
  return {
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    fatal: (message, fields) => write('fatal', message, fields),
  };
}

/**
 * Read-only view of object storage.
 *
 * The worker only ever *reads* uploads, so it implements the download half of
 * the storage contract rather than depending on the API.
 */
export function createObjectStore(env: Env): ObjectStore {
  if (env.STORAGE_DRIVER === 's3') {
    const client = new S3Client({
      region: env.S3_REGION,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY as string,
        secretAccessKey: env.S3_SECRET_KEY as string,
      },
    });
    return {
      async download(key: string): Promise<Buffer> {
        const result = await client.send(
          new GetObjectCommand({ Bucket: env.S3_BUCKET as string, Key: key }),
        );
        if (!result.Body) throw new Error(`Object ${key} has no body.`);
        return Buffer.from(await result.Body.transformToByteArray());
      },
    };
  }

  const root = resolve(env.LOCAL_STORAGE_DIR);
  return {
    async download(key: string): Promise<Buffer> {
      const target = resolve(root, key);
      if (target !== root && !target.startsWith(root + sep)) {
        throw new Error(`Refusing to read outside the storage root: ${key}`);
      }
      return readFile(target);
    },
  };
}

export interface WorkerContext {
  env: Env;
  prisma: PrismaClient;
  deps: IngestDeps;
  logger: ReturnType<typeof createLogger>;
}

export function createWorkerContext(): WorkerContext {
  const env = loadEnv();
  const logger = createLogger(env);
  const prisma = createPrismaClient(env.DATABASE_URL);
  const ai = createAiBundle(env);

  return {
    env,
    prisma,
    logger,
    deps: {
      prisma,
      embeddings: ai.embeddings,
      llm: ai.llm,
      transcription: ai.transcription,
      storage: createObjectStore(env),
      logger,
      chunking: {
        targetTokens: env.CHUNK_TARGET_TOKENS,
        overlapTokens: env.CHUNK_OVERLAP_TOKENS,
      },
    },
  };
}
