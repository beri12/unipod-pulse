import { PrismaPg } from '@prisma/adapter-pg';
import { loadEnv } from '@unipods/config';
import { PrismaClient } from '../generated/client';

export * from '../generated/client';
export { PrismaClient };

export type DatabaseClient = PrismaClient;

/**
 * Prisma 7 requires an explicit driver adapter, so the connection options live
 * here and are shared by every entry point (API, worker, seed, scripts).
 */
export function prismaClientOptions(connectionString?: string): ConstructorParameters<
  typeof PrismaClient
>[0] {
  const env = loadEnv();
  return {
    adapter: new PrismaPg({ connectionString: connectionString ?? env.DATABASE_URL }),
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  };
}

export function createPrismaClient(connectionString?: string): PrismaClient {
  return new PrismaClient(prismaClientOptions(connectionString));
}

declare global {
  var __unipodsPrisma: PrismaClient | undefined;
}

/** Process-wide singleton, safe under Next.js / Nest hot reload. */
export function getPrismaClient(): PrismaClient {
  if (!globalThis.__unipodsPrisma) {
    globalThis.__unipodsPrisma = createPrismaClient();
  }
  return globalThis.__unipodsPrisma;
}
