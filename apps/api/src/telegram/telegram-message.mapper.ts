import type { IncomingMessage } from '../bot/bot.types.js';
import type { TelegramMessage } from './telegram.types.js';

export interface MapOptions {
  /** The bot's own @username, used to tell who a command is addressed to. */
  botUsername: string;
  /** The shared command prefix, e.g. "!". */
  commandPrefix: string;
}

const displayName = (message: TelegramMessage): string | undefined => {
  const from = message.from;
  if (!from) return undefined;
  const full = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
  return full || from.username;
};

/**
 * Turns a Telegram message into the channel-neutral shape.
 *
 * Telegram writes commands as `/ping`, and in groups as `/ping@TheBotName`.
 * Both are rewritten to the shared prefix (`!ping`) so the command layer does
 * not need a Telegram special case — and `!ping` keeps working too.
 *
 * @returns null when the message is not for us (another bot's command, or no text).
 */
export function mapTelegramMessage(
  message: TelegramMessage,
  { botUsername, commandPrefix }: MapOptions,
): IncomingMessage | null {
  const text = (message.text ?? message.caption ?? '').trim();
  if (!text) return null;

  const isGroup = message.chat.type === 'group' || message.chat.type === 'supergroup';
  const me = botUsername.toLowerCase().replace(/^@/, '');

  const firstWord = text.split(/\s+/)[0] ?? '';
  let normalisedText = text;
  let addressedToMe = false;

  if (firstWord.startsWith('/')) {
    let command = firstWord.slice(1);
    const at = command.indexOf('@');

    if (at >= 0) {
      const target = command.slice(at + 1).toLowerCase();
      command = command.slice(0, at);

      if (me) {
        // "/ping@SomeOtherBot" in a shared group is not ours to answer.
        if (target !== me) return null;
      } else if (isGroup) {
        // We do not know our own @name yet (getMe has not succeeded). In a
        // group with several bots, answering a command addressed to a name we
        // cannot check would mean replying on another bot's behalf. In a
        // private chat nobody else could be meant, so it is safe there.
        return null;
      }
      addressedToMe = true;
    }

    normalisedText = commandPrefix + command + text.slice(firstWord.length);
  }

  const mentionedMe =
    addressedToMe ||
    (me.length > 0 && new RegExp(`@${me}\\b`, 'iu').test(text)) ||
    message.reply_to_message?.from?.username?.toLowerCase() === me;

  const repliedTo = message.reply_to_message;
  const quotedText = (repliedTo?.text ?? repliedTo?.caption ?? '').trim();

  return {
    channel: 'telegram',
    chatId: String(message.chat.id),
    senderId: String(message.from?.id ?? message.chat.id),
    senderName: displayName(message),
    // chat id included: message_id is only unique within a chat.
    messageId: `${message.chat.id}:${message.message_id}`,
    text: normalisedText,
    isGroup,
    mentionedMe,
    timestamp: new Date(message.date * 1000),
    quoted: quotedText
      ? {
          messageId: repliedTo ? `${message.chat.id}:${repliedTo.message_id}` : undefined,
          text: quotedText,
          senderId: repliedTo?.from ? String(repliedTo.from.id) : undefined,
          fromBot: repliedTo?.from?.is_bot === true,
        }
      : undefined,
  };
}
