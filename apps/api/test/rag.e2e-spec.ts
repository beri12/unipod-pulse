/**
 * End-to-end: register -> sign in -> upload a document -> process it ->
 * ask a question -> receive a grounded answer -> open its citation.
 *
 * This runs against a real PostgreSQL with pgvector. Ingestion is invoked
 * directly through `@unipods/ingest` — the same code the worker runs — so the
 * test does not need Redis or a running worker process, and stays
 * deterministic.
 *
 * Run with: pnpm test:e2e   (requires DATABASE_URL; `pnpm db:up` first)
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LlmService } from '@unipods/ai';
import { loadEnv } from '@unipods/config';
import { processDocument, processMessages } from '@unipods/ingest';
import type { ChatResponse, DocumentDetail, DocumentDto, SearchResponse } from '@unipods/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { StructuredLogger } from '../src/common/logger';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';

const GUIDELINES = `# E2E Hackathon Guidelines

## Key dates

Team declarations are due Thursday, September 17, 2026, by close of business.
Final submissions close at 23:59 on Wednesday, September 23, 2026.

## Judging criteria

Projects are scored out of 100 points: technical execution (40 points),
product thinking (25 points), demo quality (20 points) and originality
(15 points).
`;

const SUITE_TAG = `e2e-${Date.now()}`;
const EMAIL = `e2e-${Date.now()}@unipods.test`;
const PASSWORD = 'e2e-password-long-enough';

describe('UniPods Pulse end to end', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let llm: LlmService;
  let http: ReturnType<typeof request>;

  let accessToken = '';
  let refreshToken = '';
  let userId = '';
  let documentId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter(new StructuredLogger('error')));
    await app.init();

    prisma = app.get(PrismaService);
    storage = app.get(StorageService);
    llm = app.get(LlmService);
    http = request(app.getHttpServer());
  }, 120_000);

  /** Polls until the document reaches a terminal state, for worker races. */
  async function waitForStatus(id: string, target: string, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const document = await prisma.document.findUniqueOrThrow({ where: { id } });
      if (document.status === target || document.status === 'FAILED') return document;
      if (Date.now() > deadline) return document;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  afterAll(async () => {
    // Remove only what this run created.
    await prisma.document.deleteMany({ where: { description: SUITE_TAG } });
    await prisma.message.deleteMany({ where: { channel: SUITE_TAG } });
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await app?.close();
  }, 60_000);

  describe('authentication', () => {
    it('rejects a weak password with field-level detail', async () => {
      const response = await http
        .post('/api/auth/register')
        .send({ email: EMAIL, name: 'E2E User', password: 'short' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.map((detail: { field: string }) => detail.field)).toContain(
        'password',
      );
    });

    it('registers an account and returns a token pair', async () => {
      const response = await http
        .post('/api/auth/register')
        .send({ email: EMAIL, name: 'E2E User', password: PASSWORD })
        .expect(201);

      expect(response.body.user.email).toBe(EMAIL);
      expect(response.body.accessToken).toBeTruthy();
      expect(JSON.stringify(response.body)).not.toContain('passwordHash');

      accessToken = response.body.accessToken;
      refreshToken = response.body.refreshToken;
      userId = response.body.user.id;
    });

    it('refuses a duplicate email', async () => {
      const response = await http
        .post('/api/auth/register')
        .send({ email: EMAIL, name: 'E2E User', password: PASSWORD })
        .expect(409);
      expect(response.body.error.code).toBe('EMAIL_TAKEN');
    });

    it('refuses a wrong password without revealing which field was wrong', async () => {
      const response = await http
        .post('/api/auth/login')
        .send({ email: EMAIL, password: 'not-the-password' })
        .expect(401);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
      // The message must not reveal whether the account exists.
      expect(response.body.error.message).not.toMatch(/no account|not found|unknown user/i);
    });

    it('signs in and returns the current user', async () => {
      const login = await http.post('/api/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200);
      accessToken = login.body.accessToken;
      refreshToken = login.body.refreshToken;

      const me = await http
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(me.body.id).toBe(userId);
    });

    it('requires a token for protected routes', async () => {
      const response = await http.get('/api/documents').expect(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rotates the refresh token and invalidates the old one', async () => {
      const rotated = await http.post('/api/auth/refresh').send({ refreshToken }).expect(200);
      expect(rotated.body.accessToken).toBeTruthy();

      // Replaying the consumed token must fail.
      await http.post('/api/auth/refresh').send({ refreshToken }).expect(401);

      accessToken = rotated.body.accessToken;
      refreshToken = rotated.body.refreshToken;
    });

    it('refuses admin-only routes for a regular member', async () => {
      await prisma.user.update({ where: { id: userId }, data: { role: 'USER' } });
      const login = await http.post('/api/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200);

      const response = await http
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(403);
      expect(response.body.error.code).toBe('FORBIDDEN');

      // The rest of the suite needs to upload, which is an admin action.
      await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
      const asAdmin = await http.post('/api/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200);
      accessToken = asAdmin.body.accessToken;
      refreshToken = asAdmin.body.refreshToken;
    });
  });

  describe('document ingestion', () => {
    it('rejects an unsupported file type', async () => {
      const response = await http
        .post('/api/documents')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', Buffer.from('binary'), { filename: 'photo.png', contentType: 'image/png' })
        .field('description', SUITE_TAG)
        .expect(415);
      expect(response.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    });

    it('accepts a Markdown document and records it as pending', async () => {
      const response = await http
        .post('/api/documents')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', Buffer.from(GUIDELINES), {
          filename: 'e2e-guidelines.md',
          contentType: 'text/markdown',
        })
        .field('title', 'E2E Hackathon Guidelines')
        .field('description', SUITE_TAG)
        .field('publishedAt', '2026-09-05T09:00:00.000Z')
        .expect(201);

      const document = response.body as DocumentDto;
      expect(document.status).toBe('PENDING');
      expect(document.type).toBe('MARKDOWN');
      documentId = document.id;
    });

    it('extracts, chunks and embeds the document', async () => {
      // Runs the same pipeline the worker runs. If a worker happens to be
      // running too, one of them claims the document and the other steps
      // aside, so the assertion is on the resulting state rather than on which
      // processor did the work.
      await processDocument(
        {
          prisma,
          embeddings: app.get('AI_BUNDLE').embeddings,
          llm,
          storage: { download: (key: string) => storage.download(key) },
        },
        documentId,
      );

      const document = await waitForStatus(documentId, 'COMPLETED');
      expect(document.status).toBe('COMPLETED');

      const chunks = await prisma.documentChunk.count({ where: { documentId } });
      expect(chunks).toBeGreaterThan(0);

      const embedded = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count FROM "document_chunks"
        WHERE "documentId" = ${documentId}::uuid AND "embedding" IS NOT NULL
      `;
      expect(Number(embedded[0]?.count ?? 0)).toBe(chunks);
    }, 60_000);

    it('exposes the indexed passages and a signed download link', async () => {
      const response = await http
        .get(`/api/documents/${documentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const detail = response.body as DocumentDetail;
      expect(detail.status).toBe('COMPLETED');
      expect(detail.chunks.length).toBeGreaterThan(0);
      expect(detail.chunks.every((chunk) => chunk.hasEmbedding)).toBe(true);
      expect(detail.downloadUrl).toBeTruthy();
    });
  });

  describe('grounded answering', () => {
    it('answers from the document and cites it', async () => {
      const response = await http
        .post('/api/chat')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ message: 'When are team declarations due?' })
        .expect(201);

      const chat = response.body as ChatResponse;
      expect(chat.diagnostics.answered).toBe(true);
      expect(chat.message.content).toMatch(/September 17/);
      expect(chat.citations.length).toBeGreaterThan(0);

      const citation = chat.citations[0]!;
      expect(citation.sourceId).toBeTruthy();
      expect(citation.quote).toBeTruthy();
      // The quote must be text that genuinely appears in the source document.
      // Markdown heading markers are removed during extraction, so they are
      // removed from the expected text too before comparing.
      const sourceText = GUIDELINES.replace(/^#+\s*/gm, '').replace(/\s+/g, ' ');
      const quoted = (citation.quote as string)
        .replace(/\s+/g, ' ')
        .replace(/\u2026$/, '')
        .trim()
        .slice(0, 60);
      expect(sourceText).toContain(quoted);
    }, 60_000);

    it('resolves a citation to a real source record', async () => {
      const chat = await http
        .post('/api/chat')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ message: 'What are the judging criteria?' })
        .expect(201);

      const citation = (chat.body as ChatResponse).citations[0];
      expect(citation).toBeDefined();

      const source = await http
        .get(`/api/sources/${citation!.sourceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(source.body.type).toBe('DOCUMENT');
      expect(source.body.referenceId).toBeTruthy();
    }, 60_000);

    it('says it could not find an answer instead of guessing, and records the gap', async () => {
      const question = `How many parking spaces does the ${SUITE_TAG} venue have?`;
      const response = await http
        .post('/api/chat')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ message: question })
        .expect(201);

      const chat = response.body as ChatResponse;
      expect(chat.diagnostics.answered).toBe(false);
      expect(chat.message.content).toContain("couldn't find a confirmed answer");
      expect(chat.citations).toHaveLength(0);

      const logged = await prisma.questionLog.findFirst({ where: { question } });
      expect(logged?.answered).toBe(false);

      // Searched rather than scanned: gaps are ordered by how often they are
      // asked, and a brand new one sorts last.
      const gaps = await http
        .get(`/api/questions/unanswered?search=${encodeURIComponent('parking spaces')}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(gaps.body.items.length).toBeGreaterThan(0);
      expect(gaps.body.items[0].status).toBe('OPEN');
    }, 60_000);

    it('keeps conversation history and lists the conversation', async () => {
      const first = await http
        .post('/api/chat')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ message: 'When do submissions close?' })
        .expect(201);

      const conversationId = (first.body as ChatResponse).conversationId;

      await http
        .post('/api/chat')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ conversationId, message: 'And the judging criteria?' })
        .expect(201);

      const detail = await http
        .get(`/api/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(detail.body.messages).toHaveLength(4);
      expect(detail.body.messages[0].role).toBe('USER');
      expect(detail.body.messages[1].role).toBe('ASSISTANT');
    }, 90_000);

    it('does not let one member read another member\'s conversation', async () => {
      const otherEmail = `other-${Date.now()}@unipods.test`;
      const other = await http
        .post('/api/auth/register')
        .send({ email: otherEmail, name: 'Other User', password: PASSWORD })
        .expect(201);

      const mine = await http
        .post('/api/chat')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ message: 'When are team declarations due?' })
        .expect(201);

      const response = await http
        .get(`/api/conversations/${(mine.body as ChatResponse).conversationId}`)
        .set('Authorization', `Bearer ${other.body.accessToken}`)
        .expect(403);
      expect(response.body.error.code).toBe('FORBIDDEN');

      await prisma.user.deleteMany({ where: { email: otherEmail } });
    }, 60_000);
  });

  describe('messages and search', () => {
    it('imports messages and makes them searchable', async () => {
      const messages = [
        {
          id: `${SUITE_TAG}-1`,
          channel: SUITE_TAG,
          author: 'Ngozi Eze',
          date: '2026-09-16T09:00:00.000Z',
          text: `Announcement: the ${SUITE_TAG} mentor rota has been published in the portal.`,
        },
        {
          id: `${SUITE_TAG}-2`,
          channel: SUITE_TAG,
          author: 'Kelechi Anyanwu',
          date: '2026-09-16T09:05:00.000Z',
          text: 'Thanks, I could not find it yesterday.',
        },
      ];

      const response = await http
        .post('/api/messages/import')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', Buffer.from(JSON.stringify(messages)), {
          filename: 'messages.json',
          contentType: 'application/json',
        })
        .field('format', 'json')
        .expect(201);

      expect(response.body.imported).toBe(2);

      const stored = await prisma.message.findMany({ where: { channel: SUITE_TAG } });
      await processMessages(
        {
          prisma,
          embeddings: app.get('AI_BUNDLE').embeddings,
          llm,
          storage: { download: async () => Buffer.alloc(0) },
        },
        stored.map((message) => message.id),
      );

      const search = await http
        .get(`/api/search?q=${encodeURIComponent(`${SUITE_TAG} mentor rota`)}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const results = (search.body as SearchResponse).results;
      expect(results.length).toBeGreaterThan(0);
      // Snippets carry <mark> highlighting around matched terms, so the tags
      // are stripped before checking the text.
      const plain = results.map((result) => result.snippet.replace(/<\/?mark>/g, ''));
      expect(plain.some((snippet) => snippet.includes('mentor rota'))).toBe(true);
    }, 90_000);

    it('re-importing the same export does not duplicate messages', async () => {
      const before = await prisma.message.count({ where: { channel: SUITE_TAG } });
      const messages = [
        {
          id: `${SUITE_TAG}-1`,
          channel: SUITE_TAG,
          author: 'Ngozi Eze',
          date: '2026-09-16T09:00:00.000Z',
          text: `Announcement: the ${SUITE_TAG} mentor rota has been published in the portal.`,
        },
      ];

      const response = await http
        .post('/api/messages/import')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', Buffer.from(JSON.stringify(messages)), {
          filename: 'messages.json',
          contentType: 'application/json',
        })
        .field('format', 'json')
        .expect(201);

      expect(response.body.imported).toBe(0);
      expect(response.body.skipped).toBe(1);
      expect(await prisma.message.count({ where: { channel: SUITE_TAG } })).toBe(before);
    }, 60_000);
  });

  describe('health and admin', () => {
    it('reports service health without authentication', async () => {
      const response = await http.get('/api/health').expect(200);
      expect(response.body.status).toBeDefined();
      expect(response.body.services.find((s: { name: string }) => s.name === 'database').status).toBe(
        'ok',
      );
    });

    it('returns admin statistics for an administrator', async () => {
      const response = await http
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(response.body.knowledge.chunks).toBeGreaterThan(0);
      expect(response.body.questions.total).toBeGreaterThan(0);
    });
  });

  describe('demo isolation', () => {
    it('keeps demo content out of retrieval when demo mode is off', async () => {
      const env = loadEnv();
      if (env.DEMO_MODE) {
        // In demo mode the opposite rule applies and is covered by the seed.
        return;
      }
      const chat = await http
        .post('/api/chat')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ message: 'When are team declarations due?' })
        .expect(201);

      const sourceIds = (chat.body as ChatResponse).citations.map((citation) => citation.sourceId);
      if (sourceIds.length === 0) return;
      const sources = await prisma.source.findMany({
        where: { id: { in: sourceIds } },
        include: { document: true, meeting: true, message: true },
      });
      for (const source of sources) {
        const isDemo =
          source.document?.isDemo || source.meeting?.isDemo || source.message?.isDemo || false;
        expect(isDemo).toBe(false);
      }
    }, 60_000);
  });
});
