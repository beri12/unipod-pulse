import { Injectable, Logger } from '@nestjs/common';
import type { IncomingMessage, OutgoingReply } from './bot.types.js';
import { CommandRouterService } from './commands/command-router.service.js';
import { MessageLogService } from './message-log.service.js';

/**
 * Watches every message without replying to it — used to learn from what
 * people write. An observer must never block or break the reply.
 */
export type MessageObserver = (message: IncomingMessage) => Promise<unknown>;

/**
 * Runs before routing and may rewrite the message — this is how a voice note
 * becomes text. Returning a reply ends the turn there.
 */
export type MessagePreprocessor = (
  message: IncomingMessage,
) => Promise<OutgoingReply | null | undefined>;

/**
 * The one path every message takes, whatever transport it arrived on:
 * observe, route, record.
 *
 * Transports keep only what is specific to them: de-duplication and sending.
 */
@Injectable()
export class BotPipelineService {
  private readonly logger = new Logger(BotPipelineService.name);
  private readonly observers: MessageObserver[] = [];
  private readonly preprocessors: MessagePreprocessor[] = [];

  constructor(
    private readonly router: CommandRouterService,
    private readonly messageLog: MessageLogService,
  ) {}

  registerObserver(observer: MessageObserver): void {
    this.observers.push(observer);
  }

  registerPreprocessor(preprocessor: MessagePreprocessor): void {
    this.preprocessors.push(preprocessor);
  }

  async handle(message: IncomingMessage): Promise<OutgoingReply | null> {
    for (const preprocessor of this.preprocessors) {
      try {
        const reply = await preprocessor(message);
        if (reply) {
          this.messageLog.record(message, reply.text);
          return reply;
        }
      } catch (error) {
        this.logger.error('A message preprocessor failed', error as Error);
      }
    }

    for (const observer of this.observers) {
      try {
        await observer(message);
      } catch (error) {
        this.logger.error('A message observer failed', error as Error);
      }
    }

    const reply = await this.router.route(message);
    this.messageLog.record(message, reply?.text ?? null);
    return reply;
  }
}
