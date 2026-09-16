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
import { DocumentsService } from './documents.service';
import {
  CreateDocumentDto,
  ListDocumentsQueryDto,
  UploadDocumentBodyDto,
} from './dto/documents.dto';

@ApiTags('documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Roles('ADMIN')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadDocumentBodyDto })
  @ApiOperation({
    summary: 'Upload a document for indexing (admin only)',
    description:
      'Stores the file and queues extraction, chunking and embedding. Returns immediately with status PENDING.',
  })
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: MulterFile | undefined,
    @Body() dto: CreateDocumentDto,
  ) {
    return this.documents.upload(user.id, file, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List documents' })
  list(@Query() query: ListDocumentsQueryDto) {
    return this.documents.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'A document with its chunks and a signed download link' })
  byId(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.documents.byId(id);
  }

  @Roles('ADMIN')
  @Post(':id/process')
  @ApiOperation({ summary: 'Re-run processing for a document (admin only)' })
  process(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.documents.reprocess(id);
  }

  @Roles('ADMIN')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a document, its chunks and its stored file (admin only)' })
  remove(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.documents.remove(id);
  }
}
