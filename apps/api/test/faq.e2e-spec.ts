import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { FaqMatcherService } from './../src/faq/faq-matcher.service.js';
import type { FaqEntry, FaqMatch } from './../src/faq/faq.types.js';
import { TelegramApiService } from './../src/telegram/telegram-api.service.js';

const GROUP_ID = -100777;
const ADMIN_ID = 900;
const MEMBER_ID = 555;

let messageCounter = 0;

/**
 * A Telegram group message. `replyTo` makes it a reply, which is how an admin
 * answer gets attached to the question it answers.
 */
const groupMessage = (
  text: string,
  from: number,
  replyTo?: { text: string; from: number; isBot?: boolean },
) => {
  messageCounter += 1;
  return {
    update_id: messageCounter,
    message: {
      message_id: messageCounter,
      from: {
        id: from,
        is_bot: false,
        first_name: from === ADMIN_ID ? 'Youssef' : 'Amina',
      },
      chat: { id: GROUP_ID, type: 'supergroup', title: 'UniPod Community' },
      date: 1767225600,
      text,
      ...(replyTo
        ? {
            reply_to_message: {
              message_id: messageCounter * 1000,
              from: { id: replyTo.from, is_bot: replyTo.isBot ?? false, first_name: 'Someone' },
              chat: { id: GROUP_ID, type: 'supergroup' },
              date: 1767225500,
              text: replyTo.text,
            },
          }
        : {}),
    },
  };
};

describe('Learned answers (e2e)', () => {
  let app: INestApplication;
  let sent: { chatId: string; text: string }[];
  /** Stands in for Claude: the test decides what "the same question" means. */
  let decide: (question: string, entries: FaqEntry[]) => FaqMatch | null;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'faq-e2e-'));
    Object.assign(process.env, {
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_MODE: 'webhook',
      WHATSAPP_GROUP_BOT_ENABLED: 'false',
      ANTHROPIC_API_KEY: 'test-key',
      FAQ_STORE_PATH: join(directory, 'faq.json'),
      FAQ_MIN_CONFIDENCE: '0.75',
    });

    sent = [];
    decide = () => null;

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
      // Claude is not called in tests; the stub plays its part.
      .overrideProvider(FaqMatcherService)
      .useValue({
        enabled: true,
        match: async (question: string, entries: FaqEntry[]) => decide(question, entries),
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

  const learnedHere = async (): Promise<string> => {
    sent = [];
    await post(groupMessage('/faq@UniPodPulseBot', MEMBER_ID));
    return sent[0]?.text ?? '';
  };

  it('learns when an admin replies to a question, then answers it again later', async () => {
    // 1. A member asks, an admin answers. The bot says nothing.
    await post(
      groupMessage('We open 9h to 19h, Monday to Friday.', ADMIN_ID, {
        text: 'what are the opening hours?',
        from: MEMBER_ID,
      }),
    );
    expect(sent).toHaveLength(0);

    // 2. It remembered the pair.
    expect(await learnedHere()).toContain('what are the opening hours?');

    // 3. Someone asks the same thing in different words, in another language.
    decide = (_question, entries) => ({ entry: entries[0]!, confidence: 0.95 });
    sent = [];
    await post(groupMessage('@UniPodPulseBot chhal mn sa3a katbdaw?', MEMBER_ID));

    // 4. The bot repeats the admin's answer, word for word.
    expect(sent).toEqual([
      { chatId: String(GROUP_ID), text: 'We open 9h to 19h, Monday to Friday.' },
    ]);
  });

  it('stays silent when Claude is not confident enough', async () => {
    await post(
      groupMessage('We open 9h to 19h.', ADMIN_ID, {
        text: 'what are the opening hours?',
        from: MEMBER_ID,
      }),
    );

    decide = (_question, entries) => ({ entry: entries[0]!, confidence: 0.4 });
    sent = [];
    await post(groupMessage('@UniPodPulseBot when do you close?', MEMBER_ID));

    expect(sent).toHaveLength(0);
  });

  it('does not learn from a member who is not an admin', async () => {
    await post(
      groupMessage('I think it is 9h', MEMBER_ID, {
        text: 'what are the opening hours?',
        from: 777,
      }),
    );

    expect(await learnedHere()).toContain('not learned anything here yet');
  });

  it('answers a learned question in a private chat too', async () => {
    await post(
      groupMessage('The wifi password is unipod2026.', ADMIN_ID, {
        text: 'what is the wifi password?',
        from: MEMBER_ID,
      }),
    );

    decide = (_question, entries) => ({ entry: entries[0]!, confidence: 0.9 });
    sent = [];
    // Same chat id, private type — a member writing to the bot directly.
    await post({
      update_id: 9001,
      message: {
        message_id: 9001,
        from: { id: MEMBER_ID, is_bot: false, first_name: 'Amina' },
        chat: { id: GROUP_ID, type: 'private' },
        date: 1767225600,
        text: 'quel est le mot de passe wifi ?',
      },
    });

    expect(sent[0]?.text).toBe('The wifi password is unipod2026.');
  });

  it('lets an admin teach directly with !learn', async () => {
    sent = [];
    await post(
      groupMessage('/learn@UniPodPulseBot is there parking? | Yes, free parking behind the building.', ADMIN_ID),
    );

    expect(sent[0]?.text).toContain('Learned');
    expect(await learnedHere()).toContain('is there parking?');
  });

  it('refuses !learn from a member who is not an admin', async () => {
    sent = [];
    await post(groupMessage('/learn@UniPodPulseBot fake | fake answer', MEMBER_ID));

    expect(sent[0]?.text).toContain('Only a group admin');
    expect(await learnedHere()).toContain('not learned anything here yet');
  });

  it('lets an admin remove a learned answer with !forget', async () => {
    await post(
      groupMessage('We open 9h to 19h.', ADMIN_ID, {
        text: 'what are the opening hours?',
        from: MEMBER_ID,
      }),
    );

    sent = [];
    await post(groupMessage('/forget@UniPodPulseBot 1', ADMIN_ID));
    expect(sent[0]?.text).toContain('Forgotten');

    expect(await learnedHere()).toContain('not learned anything here yet');
  });

  it('still answers commands normally', async () => {
    sent = [];
    await post(groupMessage('/ping@UniPodPulseBot', MEMBER_ID));

    expect(sent[0]?.text).toBe('pong ✅');
  });

  it('keeps ignoring ordinary group chatter', async () => {
    await post(
      groupMessage('We open 9h to 19h.', ADMIN_ID, {
        text: 'what are the opening hours?',
        from: MEMBER_ID,
      }),
    );

    decide = (_question, entries) => ({ entry: entries[0]!, confidence: 0.99 });
    sent = [];
    // Not addressed to the bot: it must not jump into the conversation.
    await post(groupMessage('what are the opening hours?', MEMBER_ID));

    expect(sent).toHaveLength(0);
  });
});
