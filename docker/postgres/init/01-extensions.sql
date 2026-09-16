-- Enabled before Prisma migrations run so that migrations can reference the
-- `vector` type and the trigram/unaccent helpers used by keyword search.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
