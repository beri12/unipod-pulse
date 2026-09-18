import { createHmac } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { CloudApiService } from './../src/whatsapp/cloud/cloud-api.service.js';

const VERIFY_TOKEN = 'unipod-verify-token';
const APP_SECRET = 'unipod-app-secret';

/** The shape Meta actually POSTs for an inbound text message. */
const inboundText = (body: string, id = 'wamid.TEST1') => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '0',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550000000', phone_number_id: '111' },
            contacts: [{ wa_id: '212600000000', profile: { name: 'Amina' } }],
            messages: [
              {
                from: '212600000000',
                id,
                timestamp: '1767225600',
                type: 'text',
                text: { body },
              },
            ],
          },
        },
      ],
    },
  ],
});

describe('WhatsApp Cloud API webhook (e2e)', () => {
  let app: INestApplication;
  let sent: { to: string; body: string }[];
  const originalEnv = { ...process.env };

  const boot = async (env: Record<string, string> = {}) => {
    Object.assign(process.env, {
      WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
      WHATSAPP_GROUP_BOT_ENABLED: 'false',
      ...env,
    });

    sent = [];
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Stubbed so the suite never reaches graph.facebook.com.
      .overrideProvider(CloudApiService)
      .useValue({
        enabled: true,
        sendText: async (to: string, body: string) => void sent.push({ to, body }),
        sendTemplate: async () => undefined,
        markRead: async () => undefined,
      })
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    await app.init();
  };

  afterEach(async () => {
    await app?.close();
    process.env = { ...originalEnv };
  });

  describe('GET /whatsapp/webhook (Meta verification handshake)', () => {
    beforeEach(() => boot());

    it('echoes the challenge when the verify token matches', () =>
      request(app.getHttpServer())
        .get('/whatsapp/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': VERIFY_TOKEN,
          'hub.challenge': '1158201444',
        })
        .expect(200)
        .expect('1158201444'));

    it('rejects a wrong verify token', () =>
      request(app.getHttpServer())
        .get('/whatsapp/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'not-the-token',
          'hub.challenge': '1158201444',
        })
        .expect(403));

    it('rejects a mode other than subscribe', () =>
      request(app.getHttpServer())
        .get('/whatsapp/webhook')
        .query({
          'hub.mode': 'unsubscribe',
          'hub.verify_token': VERIFY_TOKEN,
          'hub.challenge': '1158201444',
        })
        .expect(403));
  });

  describe('POST /whatsapp/webhook (inbound messages)', () => {
    beforeEach(() => boot());

    it('replies to a command', async () => {
      await request(app.getHttpServer())
        .post('/whatsapp/webhook')
        .send(inboundText('!ping'))
        .expect(200);

      expect(sent).toEqual([{ to: '212600000000', body: 'pong ✅' }]);
    });

    it('answers a bare word in a private chat', async () => {
      await request(app.getHttpServer())
        .post('/whatsapp/webhook')
        .send(inboundText('help'))
        .expect(200);

      expect(sent[0]?.body).toContain('!ping');
    });

    it('answers a redelivered message only once', async () => {
      const payload = inboundText('!ping', 'wamid.DUPLICATE');

      await request(app.getHttpServer()).post('/whatsapp/webhook').send(payload).expect(200);
      await request(app.getHttpServer()).post('/whatsapp/webhook').send(payload).expect(200);

      expect(sent).toHaveLength(1);
    });

    it('ignores a status-only callback', async () => {
      await request(app.getHttpServer())
        .post('/whatsapp/webhook')
        .send({
          object: 'whatsapp_business_account',
          entry: [
            {
              id: '0',
              changes: [
                {
                  field: 'messages',
                  value: { statuses: [{ id: 'wamid.X', status: 'delivered' }] },
                },
              ],
            },
          ],
        })
        .expect(200);

      expect(sent).toHaveLength(0);
    });

    it('answers 200 even on a payload it cannot parse, so Meta stops retrying', async () => {
      await request(app.getHttpServer())
        .post('/whatsapp/webhook')
        .send({ object: 'whatsapp_business_account', entry: 'not-an-array' })
        .expect(200);

      expect(sent).toHaveLength(0);
    });

    it('records what it received for GET /whatsapp/messages', async () => {
      await request(app.getHttpServer())
        .post('/whatsapp/webhook')
        .send(inboundText('!ping', 'wamid.LOGGED'))
        .expect(200);

      const { body } = await request(app.getHttpServer()).get('/whatsapp/messages').expect(200);

      expect(body[0]).toMatchObject({
        channel: 'cloud',
        senderName: 'Amina',
        text: '!ping',
        reply: 'pong ✅',
      });
    });
  });

  describe('POST /whatsapp/webhook with WHATSAPP_APP_SECRET set', () => {
    beforeEach(() => boot({ WHATSAPP_APP_SECRET: APP_SECRET }));

    it('handles a correctly signed payload', async () => {
      const payload = JSON.stringify(inboundText('!ping', 'wamid.SIGNED'));
      const signature = `sha256=${createHmac('sha256', APP_SECRET).update(payload).digest('hex')}`;

      await request(app.getHttpServer())
        .post('/whatsapp/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signature)
        .send(payload)
        .expect(200);

      expect(sent).toHaveLength(1);
    });

    it('drops an unsigned payload but still answers 200', async () => {
      await request(app.getHttpServer())
        .post('/whatsapp/webhook')
        .send(inboundText('!ping', 'wamid.UNSIGNED'))
        .expect(200);

      expect(sent).toHaveLength(0);
    });

    it('drops a payload signed with the wrong secret', async () => {
      const payload = JSON.stringify(inboundText('!ping', 'wamid.BADSIG'));
      const signature = `sha256=${createHmac('sha256', 'wrong').update(payload).digest('hex')}`;

      await request(app.getHttpServer())
        .post('/whatsapp/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signature)
        .send(payload)
        .expect(200);

      expect(sent).toHaveLength(0);
    });
  });
});
