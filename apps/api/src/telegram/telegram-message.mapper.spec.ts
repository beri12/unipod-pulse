import { mapTelegramMessage } from './telegram-message.mapper.js';
import type { TelegramMessage } from './telegram.types.js';

const options = { botUsername: 'UniPodPulseBot', commandPrefix: '!' };

const message = (overrides: Partial<TelegramMessage> = {}): TelegramMessage => ({
  message_id: 11,
  from: { id: 555, is_bot: false, first_name: 'Amina', last_name: 'B', username: 'amina' },
  chat: { id: 555, type: 'private' },
  date: 1767225600,
  text: 'hello',
  ...overrides,
});

describe('mapTelegramMessage', () => {
  it('maps a private message', () => {
    const mapped = mapTelegramMessage(message({ text: 'hello' }), options);

    expect(mapped).toMatchObject({
      channel: 'telegram',
      chatId: '555',
      senderId: '555',
      senderName: 'Amina B',
      messageId: '555:11',
      text: 'hello',
      isGroup: false,
    });
  });

  it('falls back to the username when there is no first name', () => {
    const mapped = mapTelegramMessage(
      message({ from: { id: 555, is_bot: false, username: 'amina' } }),
      options,
    );

    expect(mapped?.senderName).toBe('amina');
  });

  it('rewrites a Telegram command to the shared prefix', () => {
    expect(mapTelegramMessage(message({ text: '/ping' }), options)?.text).toBe('!ping');
  });

  it('keeps arguments when rewriting a command', () => {
    expect(mapTelegramMessage(message({ text: '/echo hello world' }), options)?.text).toBe(
      '!echo hello world',
    );
  });

  it('accepts the shared prefix directly too', () => {
    expect(mapTelegramMessage(message({ text: '!ping' }), options)?.text).toBe('!ping');
  });

  it('skips a message with no text', () => {
    expect(mapTelegramMessage(message({ text: undefined }), options)).toBeNull();
  });

  it('reads an image caption as text', () => {
    const mapped = mapTelegramMessage(
      message({ text: undefined, caption: '/ping' }),
      options,
    );

    expect(mapped?.text).toBe('!ping');
  });

  describe('in a group', () => {
    const group = (overrides: Partial<TelegramMessage> = {}) =>
      message({ chat: { id: -100123, type: 'supergroup', title: 'UniPod' }, ...overrides });

    it('marks the message as a group message', () => {
      const mapped = mapTelegramMessage(group({ text: '/ping' }), options);

      expect(mapped).toMatchObject({ isGroup: true, chatId: '-100123', senderId: '555' });
    });

    it('handles /command@ThisBot and treats it as addressed to us', () => {
      const mapped = mapTelegramMessage(group({ text: '/ping@UniPodPulseBot' }), options);

      expect(mapped?.text).toBe('!ping');
      expect(mapped?.mentionedMe).toBe(true);
    });

    it('is case-insensitive about its own username', () => {
      const mapped = mapTelegramMessage(group({ text: '/ping@unipodpulsebot' }), options);

      expect(mapped?.text).toBe('!ping');
    });

    it('ignores a command aimed at a different bot', () => {
      expect(mapTelegramMessage(group({ text: '/ping@SomeOtherBot' }), options)).toBeNull();
    });

    it('detects a plain @mention', () => {
      const mapped = mapTelegramMessage(group({ text: '@UniPodPulseBot salam' }), options);

      expect(mapped?.mentionedMe).toBe(true);
    });

    it('does not treat a mention of another bot as its own', () => {
      const mapped = mapTelegramMessage(group({ text: '@SomeOtherBot salam' }), options);

      expect(mapped?.mentionedMe).toBe(false);
    });

    it('treats a reply to the bot as addressing it', () => {
      const mapped = mapTelegramMessage(
        group({
          text: 'and the hours?',
          reply_to_message: message({
            from: { id: 9, is_bot: true, username: 'UniPodPulseBot' },
          }),
        }),
        options,
      );

      expect(mapped?.mentionedMe).toBe(true);
    });

    it('leaves ordinary chatter unaddressed', () => {
      const mapped = mapTelegramMessage(group({ text: 'see you tomorrow' }), options);

      expect(mapped?.mentionedMe).toBe(false);
    });
  });

  it('still works before getMe() has returned a username', () => {
    // The poller may receive an update before the username is known.
    const mapped = mapTelegramMessage(message({ text: '/ping' }), {
      botUsername: '',
      commandPrefix: '!',
    });

    expect(mapped?.text).toBe('!ping');
    expect(mapped?.mentionedMe).toBe(false);
  });
});

describe('mapTelegramMessage before getMe() has succeeded', () => {
  const unknown = { botUsername: '', commandPrefix: '!' };

  const group = (text: string): TelegramMessage => ({
    message_id: 11,
    from: { id: 555, is_bot: false, first_name: 'Amina' },
    chat: { id: -100123, type: 'supergroup', title: 'UniPod' },
    date: 1767225600,
    text,
  });

  it('refuses a group command addressed to any bot name', () => {
    // It cannot check whether "@SomeOtherBot" is itself, and answering on
    // another bot's behalf in a shared group is worse than staying quiet.
    expect(mapTelegramMessage(group('/ping@SomeOtherBot'), unknown)).toBeNull();
    expect(mapTelegramMessage(group('/ping@UniPodPulseBot'), unknown)).toBeNull();
  });

  it('still answers an unaddressed group command', () => {
    expect(mapTelegramMessage(group('/ping'), unknown)?.text).toBe('!ping');
  });

  it('still answers an addressed command in a private chat', () => {
    const privateMessage: TelegramMessage = {
      message_id: 11,
      from: { id: 555, is_bot: false, first_name: 'Amina' },
      chat: { id: 555, type: 'private' },
      date: 1767225600,
      text: '/ping@UniPodPulseBot',
    };

    expect(mapTelegramMessage(privateMessage, unknown)?.text).toBe('!ping');
  });
});
