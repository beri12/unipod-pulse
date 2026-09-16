import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ChatService } from './chat.service';
import { ChatRequestDto } from './dto/chat.dto';

@ApiTags('chat')
@ApiBearerAuth()
@Controller()
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  // Answering costs an embedding call plus a model call, so chat gets a
  // tighter budget than ordinary reads.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('chat')
  @ApiOperation({
    summary: 'Ask the community knowledge base a question',
    description:
      'Returns an answer grounded in retrieved sources plus the citations supporting it. ' +
      'When retrieval finds no supporting evidence the answer says so and the question is logged as an information gap.',
  })
  ask(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChatRequestDto) {
    return this.chat.ask(user.id, dto);
  }

  @Get('conversations')
  @ApiOperation({ summary: 'Your conversations, most recently updated first' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.chat.listConversations(user.id);
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'A conversation with its messages and citations' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.chat.getConversation(user.id, id);
  }

  @Delete('conversations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a conversation and its messages' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.chat.deleteConversation(user.id, id);
  }
}
