import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DOCUMENT_TYPES, PROCESSING_STATUSES } from '@unipods/types';
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CreateDocumentDto {
  @ApiPropertyOptional({ description: 'Defaults to the uploaded file name' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({
    description:
      'When the document was published. Used for recency ranking and conflict resolution; defaults to the upload time.',
  })
  @IsOptional()
  @IsISO8601({}, { message: 'publishedAt must be an ISO 8601 date' })
  publishedAt?: string;
}

export class ListDocumentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PROCESSING_STATUSES })
  @IsOptional()
  @IsIn(PROCESSING_STATUSES)
  status?: string;

  @ApiPropertyOptional({ enum: DOCUMENT_TYPES })
  @IsOptional()
  @IsIn(DOCUMENT_TYPES)
  type?: string;
}

export class UploadDocumentBodyDto extends CreateDocumentDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'PDF, DOCX, TXT or Markdown' })
  file!: unknown;
}
