import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { KnowledgeClaudeService } from './../src/knowledge/claude.service.js';
import type { KnowledgeEntry } from './../src/knowledge/knowledge.types.js';
import { TelegramApiService } from './../src/telegram/telegram-api.service.js';
import { TranscriptionService } from './../src/voice/transcription.service.js';

const GROUP_ID = -100777;
const ADMIN_ID = 900;
const MEMBER_ID = 555;
const TOKEN = 'ingest-secret';

let counter = 0;

/**
 * A Telegram voice note: no text, just a file id and a duration.
 *
 * `where` matters. A voice note cannot carry an @mention, so in a group the
 * bot only treats it as addressed when it replies to one of the bot's own
 * messages — the same rule as for text, which keeps the bot out of a busy
 * group's conversation.
 */
const voiceMessage = (
  durationSeconds: number,
  from: number,
  where: 'group' | 'private' | 'reply-to-bot' = 'group',
) => {
  counter += 1;
  return {
    update_id: counter,
    message: {
      message_id: counter,
      from: { id: from, is_bot: false, first_name: from === ADMIN_ID ? 'Youssef' : 'Amina' },
      chat:
        where === 'private'
          ? { id: from, type: 'private' }
          : { id: GROUP_ID, type: 'supergroup', title: 'UniPod Community' },
      date: Math.floor(Date.now() / 1000),
      voice: { file_id: `file-${counter}`, file_unique_id: `u${counter}`, duration: durationSeconds },
      ...(where === 'reply-to-bot'
        ? {
            reply_to_message: {
              message_id: counter * 1000,
              from: { id: 1, is_bot: true, username: 'UniPodPulseBot' },
              chat: { id: GROUP_ID, type: 'supergroup' },
              date: Math.floor(Date.now() / 1000) - 60,
              text: 'Hello 👋',
            },
          }
        : {}),
    },
  };
};

describe('Voice messages (e2e)', () => {
  let app: INestApplication;
  let sent: { chatId: string; text: string }[];
  let transcript: string | null;
  let downloaded: string[];
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'voice-e2e-'));
    Object.assign(process.env, {
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_MODE: 'webhook',
      WHATSAPP_GROUP_BOT_ENABLED: 'false',
      ANTHROPIC_API_KEY: 'test-key',
      OPENAI_API_KEY: 'test-key',
      KNOWLEDGE_DATA_DIR: dataDir,
      KNOWLEDGE_INGEST_TOKEN: TOKEN,
      VOICE_IMPORT_FROM_SECONDS: '120',
    });

    sent = [];
    downloaded = [];
    transcript = 'chhal mn sa3a katbdaw?';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TelegramApiService)
      .useValue({
        enabled: true,
        getMe: async () => ({ id: 1, is_bot: true, username: 'UniPodPulseBot' }),
        sendMessage: async (chatId: string, text: string) => void sent.push({ chatId, text }),
        getChatAdministrators: async () => [{ user: { id: ADMIN_ID, is_bot: false } }],
        downloadFile: async (fileId: string) => {
          downloaded.push(fileId);
          return { data: Buffer.from('fake audio bytes'), filename: 'voice.oga' };
        },
        setWebhook: async () => undefined,
        deleteWebhook: async () => undefined,
        getUpdates: async () => [],
      })
      .overrideProvider(TranscriptionService)
      .useValue({ enabled: true, transcribe: async () => transcript })
      .overrideProvider(KnowledgeClaudeService)
      .useValue({
        enabled: true,
        summarise: async (title: string) => `covers ${title}`,
        selectRelevant: async (_q: string, entries: KnowledgeEntry[]) =>
          entries.map((entry) => entry.id),
        composeAnswer: async (_question: string, entries: KnowledgeEntry[]) =>
          entries.length > 0
            ? {
                answer: 'We open 9h to 19h.',
                confidence: 0.95,
                citationIds: [entries[0]!.id],
                isCommunityQuestion: true,
              }
            : { answer: null, confidence: 0, citationIds: [], isCommunityQuestion: true },
        catchUp: async () => 'nothing much',
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

  const entries = async (): Promise<KnowledgeEntry[]> => {
    const { body } = await request(app.getHttpServer())
      .get('/knowledge/entries')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200);
    return body;
  };

  /** Teaches the bot an answer, so a spoken question has something to find. */
  const teach = async () => {
    await post({
      update_id: 5000,
      message: {
        message_id: 5000,
        from: { id: ADMIN_ID, is_bot: false, first_name: 'Youssef' },
        chat: { id: GROUP_ID, type: 'supergroup' },
        date: Math.floor(Date.now() / 1000),
        text: 'We open 9h to 19h.',
        reply_to_message: {
          message_id: 4999,
          from: { id: MEMBER_ID, is_bot: false, first_name: 'Amina' },
          chat: { id: GROUP_ID, type: 'supergroup' },
          date: Math.floor(Date.now() / 1000) - 60,
          text: 'what are the opening hours?',
        },
      },
    });

    sent = [];
  };

  it('downloads a voice note in a private chat and answers the spoken question', async () => {
    await teach();

    await post(voiceMessage(8, MEMBER_ID, 'private'));

    expect(downloaded).toHaveLength(1);
    expect(sent[0]?.text).toContain('We open 9h to 19h.');
  });

  it('answers a group voice note that replies to the bot', async () => {
    await teach();

    await post(voiceMessage(8, MEMBER_ID, 'reply-to-bot'));

    expect(sent[0]?.text).toContain('We open 9h to 19h.');
  });

  it('stays out of a group voice note that was not addressed to it', async () => {
    await teach();

    // Transcribing it is fine; replying to every voice note in a busy group
    // is not. Same rule as for text messages.
    await post(voiceMessage(8, MEMBER_ID));

    expect(sent).toHaveLength(0);
  });

  it('imports a long recording from an admin into the knowledge base', async () => {
    transcript = 'Youssef: we moved the weekly call to Thursday at 18h.';
    sent = [];

    await post(voiceMessage(1800, ADMIN_ID));

    expect(sent[0]?.text).toContain('30 minute recording');

    const stored = await entries();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ type: 'meeting' });
  });

  it('treats a long recording from a member as an ordinary message', async () => {
    sent = [];
    await post(voiceMessage(1800, MEMBER_ID));

    expect(await entries()).toHaveLength(0);
  });

  it('says so when the recording could not be understood', async () => {
    transcript = null;
    sent = [];

    await post(voiceMessage(8, MEMBER_ID, 'private'));

    expect(sent[0]?.text).toContain('could not understand');
  });
});
