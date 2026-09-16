import { PrismaPg } from '@prisma/adapter-pg';
import { loadEnv } from '@unipods/config';
import { PrismaClient } from '../generated/client';

export * from '../generated/client';
export { PrismaClient };

export type DatabaseClient = PrismaClient;

/**
 * Prisma 7 requires an explicit driver adapter. One pool per process is reused
 * across hot reloads in development so we do not exhaust Postgres connections.
 */
export function createPrismaClient(connectionString?: string): PrismaClient {
  const env = loadEnv();
  const adapter = new PrismaPg({ connectionString: connectionString ?? env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log:
      env.NODE_ENV === 'development'
        ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
        : [{ emit: 'event', level: 'error' }],
  });
}

declare global {
  // eslint-disable-next-line no-var
  var __unipodsPrisma: PrismaClient | undefined;
}

/** Process-wide singleton, safe under Next.js / Nest hot reload. */
export function getPrismaClient(): PrismaClient {
  if (!globalThis.__unipodsPrisma) {
    globalThis.__unipodsPrisma = createPrismaClient();
  }
  return globalThis.__unipodsPrisma;
}
