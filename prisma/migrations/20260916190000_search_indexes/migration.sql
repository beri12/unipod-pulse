-- Search indexes that Prisma's schema language cannot express.
--
-- 1. HNSW cosine indexes for approximate nearest-neighbour search over the
--    pgvector `embedding` columns.
-- 2. GIN expression indexes over `to_tsvector('english', content)` powering the
--    keyword half of hybrid retrieval.
-- 3. Trigram indexes used by the admin knowledge browser's substring search.
--
-- These objects are invisible to `schema.prisma`; keep this migration when
-- editing the schema (see docs/rag.md).

-- --- Vector indexes --------------------------------------------------------
CREATE INDEX IF NOT EXISTS "document_chunks_embedding_hnsw_idx"
  ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "meeting_chunks_embedding_hnsw_idx"
  ON "meeting_chunks" USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "message_chunks_embedding_hnsw_idx"
  ON "message_chunks" USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "unanswered_questions_embedding_hnsw_idx"
  ON "unanswered_questions" USING hnsw ("embedding" vector_cosine_ops);

-- --- Full-text search indexes ----------------------------------------------
CREATE INDEX IF NOT EXISTS "document_chunks_content_fts_idx"
  ON "document_chunks" USING GIN (to_tsvector('english', "content"));

CREATE INDEX IF NOT EXISTS "meeting_chunks_content_fts_idx"
  ON "meeting_chunks" USING GIN (to_tsvector('english', "content"));

CREATE INDEX IF NOT EXISTS "message_chunks_content_fts_idx"
  ON "message_chunks" USING GIN (to_tsvector('english', "content"));

CREATE INDEX IF NOT EXISTS "meeting_transcripts_content_fts_idx"
  ON "meeting_transcripts" USING GIN (to_tsvector('english', "content"));

CREATE INDEX IF NOT EXISTS "messages_content_fts_idx"
  ON "messages" USING GIN (to_tsvector('english', "content"));

CREATE INDEX IF NOT EXISTS "documents_title_fts_idx"
  ON "documents" USING GIN (to_tsvector('english', "title"));

CREATE INDEX IF NOT EXISTS "meetings_title_fts_idx"
  ON "meetings" USING GIN (to_tsvector('english', "title"));

-- --- Trigram indexes --------------------------------------------------------
CREATE INDEX IF NOT EXISTS "sources_title_trgm_idx"
  ON "sources" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "unanswered_questions_norm_trgm_idx"
  ON "unanswered_questions" USING GIN ("normalizedQuestion" gin_trgm_ops);
