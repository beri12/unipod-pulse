import { Injectable } from '@nestjs/common';
import type { IncomingMessage } from './bot.types.js';

export interface LoggedMessage extends IncomingMessage {
  reply: string | null;
}

const MAX_KEPT = 200;

/**
 * In-memory ring buffer of recent traffic across every channel, exposed at
 * GET /bot/messages so you can see what the bot received without reading logs.
 *
 * This is deliberately not persistent — see README for the Postgres note.
 */
@Injectable()
export class MessageLogService {
  private readonly messages: LoggedMessage[] = [];

  record(message: IncomingMessage, reply: string | null): void {
    this.messages.unshift({ ...message, reply });
    if (this.messages.length > MAX_KEPT) this.messages.length = MAX_KEPT;
  }

  recent(limit = 50): LoggedMessage[] {
    return this.messages.slice(0, limit);
  }
}
