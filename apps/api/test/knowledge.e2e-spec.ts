import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { NO_ANSWER_REPLY } from './../src/knowledge/answer.service.js';
import { KnowledgeClaudeService } from './../src/knowledge/claude.service.js';
import type { KnowledgeEntry } from './../src/knowledge/knowledge.types.js';
import { TelegramApiService } from './../src/telegram/telegram-api.service.js';

const GROUP_ID = -100777;
const ADMIN_ID = 900;
const MEMBER_ID = 555;
const INGEST_TOKEN = 'ingest-secret';

let counter = 0;

const groupMessage = (
  text: string,
  from: number,
  replyTo?: { text: string; from: number; isBot?: boolean },
) => {
  counter += 1;
  return {
    update_id: counter,
    message: {
      message_id: counter,
      from: { id: from, is_bot: false, first_name: from === ADMIN_ID ? 'Youssef' : 'Amina' },
      chat: { id: GROUP_ID, type: 'supergroup', title: 'UniPod Community' },
      date: Math.floor(Date.now() / 1000),
      text,
      ...(replyTo
        ? {
            reply_to_message: {
              message_id: counter * 1000,
              from: { id: replyTo.from, is_bot: replyTo.isBot ?? false, first_name: 'Someone' },
              chat: { id: GROUP_ID, type: 'supergroup' },
              date: Math.floor(Date.now() / 1000) - 60,
              text: replyTo.text,
            },
          }
        : {}),
    },
  };
};

describe('Knowledge base (e2e)', () => {
  let app: INestApplication;
  let sent: { chatId: string; text: string }[];
  /** Stands in for Claude — the test decides what it "understands". */
  let compose: (
    question: string,
    entries: KnowledgeEntry[],
  ) => { answer: string | null; confidence: number; citationIds: string[] };
  let catchUpText: string | null;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kb-e2e-'));
    Object.assign(process.env, {
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_MODE: 'webhook',
      WHATSAPP_GROUP_BOT_ENABLED: 'false',
      ANTHROPIC_API_KEY: 'test-key',
      KNOWLEDGE_DATA_DIR: dataDir,
      KNOWLEDGE_INGEST_TOKEN: INGEST_TOKEN,
      KNOWLEDGE_MIN_CONFIDENCE: '0.7',
    });

    sent = [];
    compose = () => ({ answer: null, confidence: 0, citationIds: [] });
    catchUpText = 'Youssef announced the call moved to Thursday.';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TelegramApiService)
      .useValue({
        enabled: true,
        getMe: async () => ({ id: 1, is_bot: true, username: 'UniPodPulseBot' }),
        sendMessage: async (chatId: string, text: string) => void sent.push({ chatId, text }),
        getChatAdministrators: async () => [{ user: { id: ADMIN_ID, is_bot: false } }],
        setWebhook: async () => undefined,
        deleteWebhook: async () => undefined,
        getUpdates: async () => [],
      })
      .overrideProvider(KnowledgeClaudeService)
      .useValue({
        enabled: true,
        summarise: async (title: string) => `covers ${title}`,
        selectRelevant: async (_q: string, candidates: KnowledgeEntry[]) =>
          candidates.map((entry) => entry.id),
        composeAnswer: async (question: string, entries: KnowledgeEntry[]) =>
          compose(question, entries),
        catchUp: async () => catchUpText,
      })
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    process.env = { ...originalEnv };
  });

  const post = (update: object) =>
    request(app.getHttpServer()).post('/telegram/webhook').send(update).expect(200);

  const say = async (text: string, from = MEMBER_ID, replyTo?: { text: string; from: number }) => {
    sent = [];
    await post(groupMessage(text, from, replyTo));
    return sent[0]?.text ?? '';
  };

  describe('learning from admins', () => {
    it('learns an admin answer, then reuses it for the same question in other words', async () => {
      await say('We open 9h to 19h, Monday to Friday.', ADMIN_ID, {
        text: 'what are the opening hours?',
        from: MEMBER_ID,
      });
      expect(sent).toHaveLength(0);

      compose = (_question, entries) => ({
        answer: 'We open 9h to 19h, Monday to Friday.',
        confidence: 0.95,
        citationIds: [entries[0]!.id],
      });

      const reply = await say('@UniPodPulseBot chhal mn sa3a katbdaw?');

      expect(reply).toContain('We open 9h to 19h, Monday to Friday.');
      expect(reply).toContain('answered by Youssef');
    });

    it('does not learn from a member who is not an admin', async () => {
      await say('I think it is 9h', MEMBER_ID, {
        text: 'what are the opening hours?',
        from: 777,
      });

      expect(await say('/sources@UniPodPulseBot')).toContain('not learned anything here yet');
    });
  });

  describe('call transcripts', () => {
    const transcript = [
      'Youssef: welcome to the weekly call.',
      'Youssef: we decided to move the call to Thursday at 18h from now on.',
      'Amina: is the room booked until 20h?',
      'Sara: yes, until 20h every Thursday.',
    ].join('\n');

    const importCall = () =>
      request(app.getHttpServer())
        .post('/knowledge/documents')
        .set('Authorization', `Bearer ${INGEST_TOKEN}`)
        .send({
          title: 'Weekly call 12 Sep',
          content: transcript,
          type: 'meeting',
          date: '2026-09-12',
        });

    it('imports a transcript and answers from it, citing the call', async () => {
      const { body } = await importCall().expect(201);
      expect(body.imported).toBeGreaterThan(0);

      compose = (_question, entries) => ({
        answer: 'The weekly call moved to Thursday at 18h.',
        confidence: 0.9,
        citationIds: [entries[0]!.id],
      });

      const reply = await say('@UniPodPulseBot when is the weekly call now?');

      expect(reply).toContain('Thursday at 18h');
      expect(reply).toContain('Weekly call 12 Sep, 2026-09-12');
    });

    it('rejects an import without the token', async () => {
      await request(app.getHttpServer())
        .post('/knowledge/documents')
        .send({ title: 'Fake', content: 'anything' })
        .expect(401);
    });

    it('rejects an import with no content', async () => {
      await request(app.getHttpServer())
        .post('/knowledge/documents')
        .set('Authorization', `Bearer ${INGEST_TOKEN}`)
        .send({ title: 'Empty' })
        .expect(400);
    });

    it('re-importing the same call does not duplicate it', async () => {
      await importCall().expect(201);
      await importCall().expect(201);

      const { body } = await request(app.getHttpServer())
        .get('/knowledge/entries')
        .set('Authorization', `Bearer ${INGEST_TOKEN}`)
        .expect(200);

      const labels = body.filter(
        (entry: KnowledgeEntry) => entry.source?.label === 'Weekly call 12 Sep',
      );
      expect(labels.length).toBe(body.length);
    });
  });

  describe('questions nobody answered', () => {
    it('says so plainly and records the gap', async () => {
      const reply = await say('@UniPodPulseBot is there parking nearby?');

      expect(reply).toBe(NO_ANSWER_REPLY);

      const { body } = await request(app.getHttpServer())
        .get('/knowledge/gaps')
        .set('Authorization', `Bearer ${INGEST_TOKEN}`)
        .expect(200);

      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ question: 'is there parking nearby?', timesAsked: 1 });
    });

    it('shows admins the open questions, most asked first', async () => {
      await say('@UniPodPulseBot is there parking nearby?');
      await say('@UniPodPulseBot is there parking nearby?');
      await say('@UniPodPulseBot do you have a printer?');

      const reply = await say('/gaps@UniPodPulseBot', ADMIN_ID);

      expect(reply).toContain('2 open questions');
      expect(reply.indexOf('parking')).toBeLessThan(reply.indexOf('printer'));
      expect(reply).toContain('asked 2×');
    });

    it('hides the gap list from ordinary members', async () => {
      expect(await say('/gaps@UniPodPulseBot', MEMBER_ID)).toContain('Only a group admin');
    });

    it('lets an admin answer a gap, and then answers it for everyone', async () => {
      await say('@UniPodPulseBot is there parking nearby?');

      const resolved = await say(
        '/resolve@UniPodPulseBot 1 Yes, free parking behind the building.',
        ADMIN_ID,
      );
      expect(resolved).toContain('Answered');

      expect(await say('/gaps@UniPodPulseBot', ADMIN_ID)).toContain('No open questions');

      compose = (_question, entries) => ({
        answer: 'Yes, free parking behind the building.',
        confidence: 0.95,
        citationIds: [entries[0]!.id],
      });
      expect(await say('@UniPodPulseBot where can I park?')).toContain('free parking');
    });
  });

  describe('catching up', () => {
    it('summarises what happened in the group', async () => {
      await say('the call moved to Thursday', ADMIN_ID);
      await say('good to know, thanks');

      const reply = await say('/catchup@UniPodPulseBot', MEMBER_ID);

      expect(reply).toContain('last 24h');
      expect(reply).toContain('Youssef announced the call moved to Thursday.');
    });

    it('accepts a window in hours', async () => {
      await say('something happened', ADMIN_ID);

      expect(await say('/catchup@UniPodPulseBot 6', MEMBER_ID)).toContain('last 6h');
    });

    it('says plainly when there is nothing to report', async () => {
      catchUpText = null;
      const reply = await say('/catchup@UniPodPulseBot 1', MEMBER_ID);

      expect(reply).toMatch(/Nothing recorded|could not build/);
    });
  });

  describe('still a normal bot', () => {
    it('answers commands', async () => {
      expect(await say('/ping@UniPodPulseBot')).toBe('pong ✅');
    });

    it('welcomes a greeting', async () => {
      expect(await say('@UniPodPulseBot salam')).toContain('Hello');
    });

    it('never interrupts a conversation it was not part of', async () => {
      compose = (_question, entries) => ({
        answer: 'I know this one!',
        confidence: 0.99,
        citationIds: entries.map((entry) => entry.id),
      });

      // Not addressed to the bot.
      expect(await say('what are the opening hours?')).toBe('');
    });
  });
});
