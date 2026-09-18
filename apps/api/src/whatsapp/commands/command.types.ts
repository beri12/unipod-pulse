import type { IncomingMessage } from '../whatsapp.types.js';

export interface CommandContext {
  message: IncomingMessage;
  /** Command name as typed, lowercased, without the prefix. */
  command: string;
  /** Everything after the command name, split on whitespace. */
  args: string[];
  /** Raw text after the command name. */
  rest: string;
}

export interface BotCommand {
  name: string;
  description: string;
  aliases?: string[];
  handler: (ctx: CommandContext) => string | null | Promise<string | null>;
}
