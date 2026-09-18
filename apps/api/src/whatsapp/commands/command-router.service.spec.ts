import { loadWhatsappConfig } from '../whatsapp.config.js';
import type { IncomingMessage } from '../whatsapp.types.js';
import { CommandRouterService } from './command-router.service.js';

const message = (overrides: Partial<IncomingMessage> = {}): IncomingMessage => ({
  channel: 'cloud',
  chatId: '212600000000',
  senderId: '212600000000',
  senderName: 'Amina',
  messageId: 'wamid.TEST',
  text: 'hello',
  isGroup: false,
  mentionedMe: false,
  timestamp: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

describe('CommandRouterService', () => {
  let router: CommandRouterService;

  beforeEach(() => {
    router = new CommandRouterService(loadWhatsappConfig({}));
  });

  describe('in a private chat', () => {
    it('answers a command without needing a prefix', async () => {
      const reply = await router.route(message({ text: 'ping' }));

      expect(reply?.text).toBe('pong ✅');
    });

    it('answers a prefixed command too', async () => {
      const reply = await router.route(message({ text: '!ping' }));

      expect(reply?.text).toBe('pong ✅');
    });

    it('points an unknown word at the help command', async () => {
      const reply = await router.route(message({ text: 'banana' }));

      expect(reply?.text).toContain('!help');
    });

    it('lists every registered command in help', async () => {
      const reply = await router.route(message({ text: '!help' }));

      expect(reply?.text).toContain('!ping');
      expect(reply?.text).toContain('!about');
      expect(reply?.text).toContain('!help');
    });

    it('stays silent on an empty message', async () => {
      expect(await router.route(message({ text: '   ' }))).toBeNull();
    });
  });

  describe('in a group', () => {
    const groupMessage = (overrides: Partial<IncomingMessage> = {}) =>
      message({
        channel: 'group',
        chatId: '120363000000000000@g.us',
        senderId: '212600000000@s.whatsapp.net',
        isGroup: true,
        ...overrides,
      });

    it('ignores ordinary chatter', async () => {
      expect(await router.route(groupMessage({ text: 'see you tomorrow' }))).toBeNull();
    });

    it('answers a prefixed command', async () => {
      const reply = await router.route(groupMessage({ text: '!ping' }));

      expect(reply?.text).toBe('pong ✅');
    });

    it('answers when mentioned', async () => {
      const reply = await router.route(
        groupMessage({ text: '@212600000000 ping', mentionedMe: true }),
      );

      expect(reply?.text).toBe('pong ✅');
    });

    it('stays silent on an unknown word even when mentioned', async () => {
      // Otherwise every "@bot thanks!" turns into an error message in the group.
      const reply = await router.route(
        groupMessage({ text: '@212600000000 thanks!', mentionedMe: true }),
      );

      expect(reply).toBeNull();
    });

    it('greets a bare mention', async () => {
      const reply = await router.route(
        groupMessage({ text: '@212600000000', mentionedMe: true }),
      );

      expect(reply?.text).toContain('!help');
    });
  });

  describe('arguments', () => {
    it('passes everything after the command name to the handler', async () => {
      const reply = await router.route(message({ text: '!echo hello   big world' }));

      expect(reply?.text).toBe('hello   big world');
    });

    it('reports who the sender is', async () => {
      const reply = await router.route(message({ text: '!whoami' }));

      expect(reply?.text).toContain('Amina');
      expect(reply?.text).toContain('212600000000');
    });
  });

  describe('registration', () => {
    it('routes a custom command and lists it in help', async () => {
      router.register({
        name: 'desk',
        description: 'Book a desk',
        aliases: ['bureau'],
        handler: ({ args }) => `Booked ${args[0] ?? 'a desk'}`,
      });

      expect((await router.route(message({ text: '!desk 12' })))?.text).toBe('Booked 12');
      expect((await router.route(message({ text: '!bureau 4' })))?.text).toBe('Booked 4');
      expect((await router.route(message({ text: '!help' })))?.text).toContain('!desk');
    });

    it('does not let a failing command crash the request', async () => {
      router.register({
        name: 'boom',
        description: 'Always throws',
        handler: () => {
          throw new Error('kaboom');
        },
      });

      const reply = await router.route(message({ text: '!boom' }));

      expect(reply?.text).toContain('went wrong');
    });
  });

  it('honours a custom command prefix', async () => {
    const slashRouter = new CommandRouterService(
      loadWhatsappConfig({ WHATSAPP_COMMAND_PREFIX: '/' }),
    );

    expect((await slashRouter.route(message({ text: '/ping' })))?.text).toBe('pong ✅');
    expect((await slashRouter.route(message({ text: '/help' })))?.text).toContain('/ping');
  });
});
