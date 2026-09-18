import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { TelegramApiService } from './../src/telegram/telegram-api.service.js';

const SECRET = 'telegram-secret';

/** The shape Telegram actually POSTs for an inbound message. */
const update = (text: string, overrides: Record<string, unknown> = {}) => ({
  update_id: Math.floor(Math.random() * 1_000_000),
  message: {
    message_id: Math.floor(Math.random() * 1_000_000),
    from: { id: 555, is_bot: false, first_name: 'Amina', username: 'amina' },
    chat: { id: 555, type: 'private' },
    date: 1767225600,
    text,
    ...overrides,
  },
});

describe('Telegram webhook (e2e)', () => {
  let app: INestApplication;
  let sent: { chatId: string; text: string }[];
  const originalEnv = { ...process.env };

  const boot = async (env: Record<string, string> = {}) => {
    Object.assign(process.env, {
      TELEGRAM_BOT_TOKEN: 'test-token',
      // Webhook mode, so the long-polling loop never starts during tests.
      TELEGRAM_MODE: 'webhook',
      WHATSAPP_GROUP_BOT_ENABLED: 'false',
      ...env,
    });

    sent = [];
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Stubbed so the suite never reaches api.telegram.org.
      .overrideProvider(TelegramApiService)
      .useValue({
        enabled: true,
        getMe: async () => ({ id: 1, is_bot: true, username: 'UniPodPulseBot' }),
        sendMessage: async (chatId: string, text: string) => void sent.push({ chatId, text }),
        setWebhook: async () => undefined,
        deleteWebhook: async () => undefined,
        getUpdates: async () => [],
      })
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    await app.init();
  };

  afterEach(async () => {
    await app?.close();
    process.env = { ...originalEnv };
  });

  describe('without a secret token', () => {
    beforeEach(() => boot());

    it('answers a /command', async () => {
      await request(app.getHttpServer()).post('/telegram/webhook').send(update('/ping')).expect(200);

      expect(sent).toEqual([{ chatId: '555', text: 'pong ✅' }]);
    });

    it('answers the shared ! prefix too', async () => {
      await request(app.getHttpServer()).post('/telegram/webhook').send(update('!ping')).expect(200);

      expect(sent[0]?.text).toBe('pong ✅');
    });

    it('welcomes a greeting', async () => {
      await request(app.getHttpServer()).post('/telegram/webhook').send(update('salam')).expect(200);

      expect(sent[0]?.text).toContain('Hello');
    });

    it('answers /help with the same list WhatsApp gets', async () => {
      await request(app.getHttpServer()).post('/telegram/webhook').send(update('/help')).expect(200);

      expect(sent[0]?.text).toContain('!ping');
      expect(sent[0]?.text).toContain('!whoami');
    });

    it('handles a redelivered update only once', async () => {
      const payload = update('/ping');

      await request(app.getHttpServer()).post('/telegram/webhook').send(payload).expect(200);
      await request(app.getHttpServer()).post('/telegram/webhook').send(payload).expect(200);

      expect(sent).toHaveLength(1);
    });

    it('stays silent on group chatter', async () => {
      await request(app.getHttpServer())
        .post('/telegram/webhook')
        .send(
          update('see you tomorrow', { chat: { id: -100123, type: 'supergroup', title: 'UniPod' } }),
        )
        .expect(200);

      expect(sent).toHaveLength(0);
    });

    it('answers a command in a group', async () => {
      await request(app.getHttpServer())
        .post('/telegram/webhook')
        .send(
          update('/ping@UniPodPulseBot', {
            chat: { id: -100123, type: 'supergroup', title: 'UniPod' },
          }),
        )
        .expect(200);

      expect(sent).toEqual([{ chatId: '-100123', text: 'pong ✅' }]);
    });

    it('ignores a command aimed at another bot', async () => {
      await request(app.getHttpServer())
        .post('/telegram/webhook')
        .send(
          update('/ping@SomeOtherBot', {
            chat: { id: -100123, type: 'supergroup', title: 'UniPod' },
          }),
        )
        .expect(200);

      expect(sent).toHaveLength(0);
    });

    it('answers 200 on a payload it cannot parse, so Telegram stops retrying', async () => {
      await request(app.getHttpServer())
        .post('/telegram/webhook')
        .send({ update_id: 1 })
        .expect(200);

      expect(sent).toHaveLength(0);
    });

    it('records Telegram traffic in the shared log', async () => {
      await request(app.getHttpServer()).post('/telegram/webhook').send(update('/ping')).expect(200);

      const { body } = await request(app.getHttpServer()).get('/bot/messages').expect(200);

      expect(body[0]).toMatchObject({
        channel: 'telegram',
        senderName: 'Amina',
        text: '!ping',
        reply: 'pong ✅',
      });
    });
  });

  describe('with TELEGRAM_WEBHOOK_SECRET set', () => {
    beforeEach(() => boot({ TELEGRAM_WEBHOOK_SECRET: SECRET }));

    it('accepts an update carrying the right secret', async () => {
      await request(app.getHttpServer())
        .post('/telegram/webhook')
        .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
        .send(update('/ping'))
        .expect(200);

      expect(sent).toHaveLength(1);
    });

    it('drops an update with no secret', async () => {
      await request(app.getHttpServer()).post('/telegram/webhook').send(update('/ping')).expect(200);

      expect(sent).toHaveLength(0);
    });

    it('drops an update with the wrong secret', async () => {
      await request(app.getHttpServer())
        .post('/telegram/webhook')
        .set('X-Telegram-Bot-Api-Secret-Token', 'wrong')
        .send(update('/ping'))
        .expect(200);

      expect(sent).toHaveLength(0);
    });
  });
});
