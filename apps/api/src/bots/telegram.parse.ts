/**
 * Decides whether a group message is addressed to the bot.
 *
 * Kept as a pure function, separate from the polling client, because this is
 * the rule most likely to be argued about and the one most worth testing: a bot
 * that answers too eagerly adds noise to the very group this product exists to
 * calm down, and one that answers too rarely looks broken.
 */
export interface AddressContext {
  /** The bot's own @username, when known. */
  botUsername: string | null;
  /** Telegram chat type: 'private', 'group', 'supergroup', 'channel'. */
  chatType: string;
  /** True when this message replies to something the bot itself posted. */
  replyToBot: boolean;
}

export function parseAddressedQuestion(text: string, context: AddressContext): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // An explicit command always wins, and works even when the bot is renamed.
  const command = /^\/(ask|pulse)(?:@\S+)?\s+([\s\S]+)$/i.exec(trimmed);
  if (command) return nonEmpty(command[2]);

  // A bare `/ask` with nothing after it is a request for help, not a question.
  if (/^\/(ask|pulse)(?:@\S+)?$/i.test(trimmed)) return null;

  // Other slash commands belong to other bots.
  if (trimmed.startsWith('/')) return null;

  if (context.botUsername) {
    const mention = new RegExp(`@${escapeRegExp(context.botUsername)}\\b`, 'gi');
    if (mention.test(trimmed)) {
      return nonEmpty(trimmed.replace(mention, ' ').replace(/\s+/g, ' '));
    }
  }

  // Replying to the bot continues the exchange it started.
  if (context.replyToBot) return trimmed;

  // A direct chat with the bot is addressed to it by definition.
  if (context.chatType === 'private') return trimmed;

  return null;
}

/** Two characters is not a question; it is a reaction. */
function nonEmpty(value: string | undefined): string | null {
  const text = (value ?? '').trim();
  return text.length > 2 ? text : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
