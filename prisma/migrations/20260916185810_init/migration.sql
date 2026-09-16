-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('PDF', 'DOCX', 'TXT', 'MARKDOWN', 'WEB', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('DOCUMENT', 'MEETING', 'MESSAGE', 'ANNOUNCEMENT');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('OPEN', 'ANSWERED', 'IGNORED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "DocumentType" NOT NULL DEFAULT 'OTHER',
    "sourceType" "SourceKind" NOT NULL DEFAULT 'DOCUMENT',
    "originalFileName" TEXT,
    "storageKey" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "statusMessage" TEXT,
    "pageCount" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "meetingDate" TIMESTAMP(3) NOT NULL,
    "durationSeconds" INTEGER,
    "storageKey" TEXT,
    "originalFileName" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "statusMessage" TEXT,
    "summary" JSONB,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_transcripts" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "speaker" TEXT,
    "content" TEXT NOT NULL,
    "startTime" DOUBLE PRECISION NOT NULL,
    "endTime" DOUBLE PRECISION NOT NULL,
    "sequence" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_chunks" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "startTime" DOUBLE PRECISION NOT NULL,
    "endTime" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "externalId" TEXT,
    "channel" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorId" TEXT,
    "content" TEXT NOT NULL,
    "messageDate" TIMESTAMP(3) NOT NULL,
    "replyToId" UUID,
    "isAnnouncement" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_chunks" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" UUID NOT NULL,
    "type" "SourceKind" NOT NULL,
    "title" TEXT NOT NULL,
    "referenceId" UUID NOT NULL,
    "url" TEXT,
    "authorName" TEXT,
    "occurredAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "documentId" UUID,
    "meetingId" UUID,
    "messageId" UUID,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New conversation',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_citations" (
    "id" UUID NOT NULL,
    "chatMessageId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "quote" TEXT,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unanswered_questions" (
    "id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "normalizedQuestion" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "lastAskedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "QuestionStatus" NOT NULL DEFAULT 'OPEN',
    "resolutionNote" TEXT,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unanswered_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_logs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "conversationId" UUID,
    "question" TEXT NOT NULL,
    "answered" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "documents_status_idx" ON "documents"("status");

-- CreateIndex
CREATE INDEX "documents_sourceType_idx" ON "documents"("sourceType");

-- CreateIndex
CREATE INDEX "documents_createdAt_idx" ON "documents"("createdAt");

-- CreateIndex
CREATE INDEX "documents_createdById_idx" ON "documents"("createdById");

-- CreateIndex
CREATE INDEX "documents_publishedAt_idx" ON "documents"("publishedAt");

-- CreateIndex
CREATE INDEX "document_chunks_documentId_idx" ON "document_chunks"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_documentId_chunkIndex_key" ON "document_chunks"("documentId", "chunkIndex");

-- CreateIndex
CREATE INDEX "meetings_status_idx" ON "meetings"("status");

-- CreateIndex
CREATE INDEX "meetings_meetingDate_idx" ON "meetings"("meetingDate");

-- CreateIndex
CREATE INDEX "meetings_createdAt_idx" ON "meetings"("createdAt");

-- CreateIndex
CREATE INDEX "meetings_createdById_idx" ON "meetings"("createdById");

-- CreateIndex
CREATE INDEX "meeting_transcripts_meetingId_idx" ON "meeting_transcripts"("meetingId");

-- CreateIndex
CREATE INDEX "meeting_transcripts_startTime_idx" ON "meeting_transcripts"("startTime");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_transcripts_meetingId_sequence_key" ON "meeting_transcripts"("meetingId", "sequence");

-- CreateIndex
CREATE INDEX "meeting_chunks_meetingId_idx" ON "meeting_chunks"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_chunks_meetingId_chunkIndex_key" ON "meeting_chunks"("meetingId", "chunkIndex");

-- CreateIndex
CREATE INDEX "messages_messageDate_idx" ON "messages"("messageDate");

-- CreateIndex
CREATE INDEX "messages_channel_idx" ON "messages"("channel");

-- CreateIndex
CREATE INDEX "messages_authorId_idx" ON "messages"("authorId");

-- CreateIndex
CREATE INDEX "messages_isAnnouncement_idx" ON "messages"("isAnnouncement");

-- CreateIndex
CREATE UNIQUE INDEX "messages_channel_externalId_key" ON "messages"("channel", "externalId");

-- CreateIndex
CREATE INDEX "message_chunks_messageId_idx" ON "message_chunks"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "sources_documentId_key" ON "sources"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "sources_meetingId_key" ON "sources"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "sources_messageId_key" ON "sources"("messageId");

-- CreateIndex
CREATE INDEX "sources_type_idx" ON "sources"("type");

-- CreateIndex
CREATE INDEX "sources_occurredAt_idx" ON "sources"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "sources_type_referenceId_key" ON "sources"("type", "referenceId");

-- CreateIndex
CREATE INDEX "conversations_userId_idx" ON "conversations"("userId");

-- CreateIndex
CREATE INDEX "conversations_updatedAt_idx" ON "conversations"("updatedAt");

-- CreateIndex
CREATE INDEX "chat_messages_conversationId_createdAt_idx" ON "chat_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_citations_chatMessageId_idx" ON "chat_citations"("chatMessageId");

-- CreateIndex
CREATE INDEX "chat_citations_sourceId_idx" ON "chat_citations"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "unanswered_questions_normalizedQuestion_key" ON "unanswered_questions"("normalizedQuestion");

-- CreateIndex
CREATE INDEX "unanswered_questions_status_idx" ON "unanswered_questions"("status");

-- CreateIndex
CREATE INDEX "unanswered_questions_lastAskedAt_idx" ON "unanswered_questions"("lastAskedAt");

-- CreateIndex
CREATE INDEX "unanswered_questions_count_idx" ON "unanswered_questions"("count");

-- CreateIndex
CREATE INDEX "question_logs_createdAt_idx" ON "question_logs"("createdAt");

-- CreateIndex
CREATE INDEX "question_logs_answered_idx" ON "question_logs"("answered");

-- CreateIndex
CREATE INDEX "question_logs_userId_idx" ON "question_logs"("userId");

-- CreateIndex
CREATE INDEX "question_logs_conversationId_idx" ON "question_logs"("conversationId");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_transcripts" ADD CONSTRAINT "meeting_transcripts_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_chunks" ADD CONSTRAINT "meeting_chunks_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_chunks" ADD CONSTRAINT "message_chunks_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_citations" ADD CONSTRAINT "chat_citations_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_citations" ADD CONSTRAINT "chat_citations_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_logs" ADD CONSTRAINT "question_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_logs" ADD CONSTRAINT "question_logs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
