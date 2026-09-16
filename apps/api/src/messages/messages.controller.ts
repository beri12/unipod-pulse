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
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import type { UploadedFile as MulterFile } from '../common/file-validation';
import {
  ImportMessagesBodyDto,
  ImportMessagesDto,
  ListMessagesQueryDto,
} from './dto/messages.dto';
import { MessagesService } from './messages.service';

@ApiTags('messages')
@ApiBearerAuth()
@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Roles('ADMIN')
  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: ImportMessagesBodyDto })
  @ApiOperation({
    summary: 'Import a message export (admin only)',
    description:
      'Supports Telegram Desktop exports, generic JSON, CSV and plain-text chat logs. Parsing is synchronous so the response reports exactly what was read; embedding is queued.',
  })
  import(@UploadedFile() file: MulterFile | undefined, @Body() dto: ImportMessagesDto) {
    return this.messages.import(file, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List imported messages, newest first' })
  list(@Query() query: ListMessagesQueryDto) {
    return this.messages.list(query);
  }

  @Get('channels')
  @ApiOperation({ summary: 'Channels present in the knowledge base, with message counts' })
  channels() {
    return this.messages.channels();
  }

  @Roles('ADMIN')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a message and its chunks (admin only)' })
  remove(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.messages.remove(id);
  }
}
