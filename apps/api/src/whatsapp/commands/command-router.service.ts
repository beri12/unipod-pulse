import { Inject, Injectable, Logger } from '@nestjs/common';
import { WHATSAPP_CONFIG, type WhatsappConfig } from '../whatsapp.config.js';
import type { IncomingMessage, OutgoingReply } from '../whatsapp.types.js';
import { builtinCommands } from './builtin.commands.js';
import type { BotCommand, CommandContext } from './command.types.js';

/**
 * The single place that decides what the bot says, for both transports.
 *
 * The group rule matters: in a group the bot stays silent unless it is
 * addressed (prefix or @mention). A bot that answers every message gets
 * reported by members, and reports are what get numbers banned.
 */
@Injectable()
export class CommandRouterService {
  private readonly logger = new Logger(CommandRouterService.name);
  private readonly commands = new Map<string, BotCommand>();

  constructor(@Inject(WHATSAPP_CONFIG) private readonly config: WhatsappConfig) {
    for (const command of builtinCommands) this.register(command);
    this.register({
      name: 'help',
      description: 'List the available commands',
      handler: () => this.renderHelp(),
    });
  }

  register(command: BotCommand): void {
    this.commands.set(command.name.toLowerCase(), command);
    for (const alias of command.aliases ?? []) {
      this.commands.set(alias.toLowerCase(), command);
    }
  }

  /** Commands in registration order, aliases excluded. */
  list(): BotCommand[] {
    return [...new Set(this.commands.values())];
  }

  /**
   * @returns the reply to send, or null to stay silent.
   */
  async route(message: IncomingMessage): Promise<OutgoingReply | null> {
    const text = message.text.trim();
    if (!text) return null;

    const prefix = this.config.commandPrefix;
    const hasPrefix = text.startsWith(prefix);

    // In groups: only answer when addressed. In private chat: always answer.
    if (message.isGroup && !hasPrefix && !message.mentionedMe) return null;

    const body = hasPrefix ? text.slice(prefix.length) : this.stripMention(text);
    const [rawCommand = '', ...args] = body.trim().split(/\s+/);
    const name = rawCommand.toLowerCase();

    if (!name) {
      return { text: `Hi 👋 Type ${prefix}help to see what I can do.` };
    }

    const command = this.commands.get(name);
    if (!command) {
      // In a group an unknown word after a mention is usually just chatter.
      if (message.isGroup && !hasPrefix) return null;
      return {
        text: `I don't know "${name}". Type ${prefix}help for the list.`,
      };
    }

    const ctx: CommandContext = {
      message,
      command: name,
      args,
      rest: body.trim().slice(rawCommand.length).trim(),
    };

    try {
      const reply = await command.handler(ctx);
      return reply ? { text: reply } : null;
    } catch (error) {
      this.logger.error(`Command "${name}" failed`, error as Error);
      return { text: 'Something went wrong on my side. Try again in a moment.' };
    }
  }

  private renderHelp(): string {
    const prefix = this.config.commandPrefix;
    const lines = this.list()
      .map((command) => `${prefix}${command.name} — ${command.description}`)
      .sort();
    return `Commands I understand:\n${lines.join('\n')}`;
  }

  /** Removes a leading "@1234567890" left over from a mention. */
  private stripMention(text: string): string {
    return text.replace(/^@\d+\s*/, '');
  }
}
