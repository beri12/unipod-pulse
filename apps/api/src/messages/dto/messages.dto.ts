import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export const IMPORT_FORMATS = ['telegram', 'json', 'csv', 'txt'] as const;

const toBoolean = Transform(({ value }: { value: unknown }) =>
  value === undefined || value === '' ? undefined : /^(1|true|yes|on)$/i.test(String(value)),
);

export class ImportMessagesDto {
  @ApiProperty({ enum: IMPORT_FORMATS })
  @IsIn(IMPORT_FORMATS, { message: `format must be one of: ${IMPORT_FORMATS.join(', ')}` })
  format!: (typeof IMPORT_FORMATS)[number];

  @ApiPropertyOptional({
    description:
      'Channel name. Required for plain-text logs and for CSV/JSON without a channel column.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  channel?: string;

  @ApiPropertyOptional({
    description: 'Treat every imported message as an announcement (e.g. a noticeboard export)',
  })
  @IsOptional()
  @toBoolean
  @IsBoolean()
  markAsAnnouncement?: boolean;
}

export class ImportMessagesBodyDto extends ImportMessagesDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'JSON, CSV or TXT export' })
  file!: unknown;
}

export class ListMessagesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  channel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @toBoolean
  @IsBoolean()
  announcementsOnly?: boolean;
}
