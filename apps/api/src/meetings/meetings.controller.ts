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
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { UploadedFile as MulterFile } from '../common/file-validation';
import {
  CreateMeetingDto,
  ListMeetingsQueryDto,
  UploadMeetingBodyDto,
  UploadTranscriptBodyDto,
} from './dto/meetings.dto';
import { MeetingsService } from './meetings.service';

@ApiTags('meetings')
@ApiBearerAuth()
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Roles('ADMIN')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadMeetingBodyDto })
  @ApiOperation({
    summary: 'Create a meeting, with or without a recording (admin only)',
    description:
      'With a recording, transcription is queued. Without one, upload an existing transcript to /transcript — no speech-to-text provider is needed for that path.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: MulterFile | undefined,
    @Body() dto: CreateMeetingDto,
  ) {
    return this.meetings.create(user.id, file, dto);
  }

  @Roles('ADMIN')
  @Post(':id/transcript')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadTranscriptBodyDto })
  @ApiOperation({ summary: 'Import an existing timestamped transcript (admin only)' })
  importTranscript(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @UploadedFile() file: MulterFile | undefined,
  ) {
    return this.meetings.importTranscript(id, file);
  }

  @Get()
  @ApiOperation({ summary: 'List meetings, newest first' })
  list(@Query() query: ListMeetingsQueryDto) {
    return this.meetings.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'A meeting with its summary, transcript and media link' })
  byId(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.meetings.byId(id);
  }

  @Roles('ADMIN')
  @Post(':id/process')
  @ApiOperation({ summary: 'Re-run transcription/summarising for a meeting (admin only)' })
  process(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.meetings.reprocess(id);
  }

  @Roles('ADMIN')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a meeting and everything derived from it (admin only)' })
  remove(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.meetings.remove(id);
  }
}
