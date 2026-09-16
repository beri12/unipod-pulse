import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 moved connection URLs out of `schema.prisma`. Migration and
 * introspection commands read them from here; the runtime client gets its
 * connection through a driver adapter in `@unipods/database`.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || '',
  },
});
