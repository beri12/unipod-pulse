import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Loads `.env` from the monorepo root (and an app-local `.env` if present)
 * exactly once per process. Values already present in `process.env` always win,
 * so container/platform configuration is never clobbered by a checked-out file.
 */
let dotenvLoaded = false;

export function loadEnvFiles(startDir: string = process.cwd()): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;

  const candidates = new Set<string>();
  let dir = resolve(startDir);
  for (let depth = 0; depth < 5; depth += 1) {
    candidates.add(resolve(dir, '.env'));
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }

  for (const file of candidates) {
    if (existsSync(file)) {
      loadDotenv({ path: file, override: false });
    }
  }
}

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
  );

const intFromString = (fallback: number, min?: number, max?: number) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return fallback;
      const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    })
    .pipe(z.number().int().min(min ?? Number.MIN_SAFE_INTEGER).max(max ?? Number.MAX_SAFE_INTEGER));

const floatFromString = (fallback: number, min = 0, max = 1) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return fallback;
      const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    })
    .pipe(z.number().min(min).max(max));

const csv = (fallback: string[]) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value.trim() === ''
        ? fallback
        : value
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean),
    );

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DIRECT_DATABASE_URL: z.string().optional(),

    REDIS_URL: z.string().default('redis://localhost:6379'),

    AI_PROVIDER: z.enum(['openai', 'local']).default('openai'),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
    AI_MODEL: z.string().default('gpt-4o-mini'),
    EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
    EMBEDDING_DIMENSIONS: intFromString(1536, 8, 4096),
    TRANSCRIPTION_MODEL: z.string().default('whisper-1'),

    STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
    LOCAL_STORAGE_DIR: z.string().default('./storage'),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: booleanish.default(false),

    JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
    JWT_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

    PORT: intFromString(3001, 1, 65535),
    API_URL: z.string().default('http://localhost:3001'),
    CORS_ORIGINS: csv(['http://localhost:3000']),
    MAX_FILE_SIZE: intFromString(104_857_600, 1024),

    RATE_LIMIT_TTL: intFromString(60, 1),
    RATE_LIMIT_LIMIT: intFromString(100, 1),

    RAG_TOP_K: intFromString(8, 1, 50),
    RAG_MIN_SCORE: floatFromString(0.18, 0, 1),
    RAG_WEIGHT_SEMANTIC: floatFromString(0.6),
    RAG_WEIGHT_KEYWORD: floatFromString(0.25),
    RAG_WEIGHT_RECENCY: floatFromString(0.1),
    RAG_WEIGHT_SOURCE: floatFromString(0.05),
    CHUNK_TARGET_TOKENS: intFromString(600, 100, 4000),
    CHUNK_OVERLAP_TOKENS: intFromString(80, 0, 1000),

    DEMO_MODE: booleanish.default(false),
  })
  .superRefine((value, ctx) => {
    if (value.AI_PROVIDER === 'openai' && !value.OPENAI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OPENAI_API_KEY'],
        message:
          'OPENAI_API_KEY is required when AI_PROVIDER=openai. Set AI_PROVIDER=local to run without an external AI provider.',
      });
    }
    if (value.STORAGE_DRIVER === 's3') {
      for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
        if (!value[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when STORAGE_DRIVER=s3`,
          });
        }
      }
    }
    if (value.NODE_ENV === 'production') {
      if (value.JWT_SECRET.includes('change-me') || value.JWT_SECRET.startsWith('dev-only')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_SECRET'],
          message: 'Refusing to start in production with the example JWT_SECRET.',
        });
      }
      if (
        value.JWT_REFRESH_SECRET.includes('change-me') ||
        value.JWT_REFRESH_SECRET.startsWith('dev-only')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_REFRESH_SECRET'],
          message: 'Refusing to start in production with the example JWT_REFRESH_SECRET.',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Parses and caches process.env. Throws a readable error listing every problem. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  loadEnvFiles();
  const result = envSchema.safeParse(source === process.env ? process.env : source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  cached = result.data;
  return cached;
}

/** Test helper — clears the memoised env so a new one can be parsed. */
export function resetEnvCache(): void {
  cached = null;
  dotenvLoaded = false;
}
