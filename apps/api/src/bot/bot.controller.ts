import { Controller, Get } from '@nestjs/common';
import { MessageLogService } from './message-log.service.js';

@Controller('bot')
export class BotController {
  constructor(private readonly messageLog: MessageLogService) {}

  /**
   * Recent traffic across every channel, for eyeballing what the bot received.
   *
   * Unauthenticated debug view of message content — remove it or put it behind
   * auth before production.
   */
  @Get('messages')
  recent() {
    return this.messageLog.recent();
  }
}
