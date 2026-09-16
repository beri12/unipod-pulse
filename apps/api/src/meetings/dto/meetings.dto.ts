import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PROCESSING_STATUSES } from '@unipods/types';
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CreateMeetingDto {
  @ApiProperty({ example: 'AI Architecture Meeting' })
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: '2026-09-15T14:00:00.000Z' })
  @IsISO8601({}, { message: 'meetingDate must be an ISO 8601 date' })
  meetingDate!: string;
}

export class ListMeetingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PROCESSING_STATUSES })
  @IsOptional()
  @IsIn(PROCESSING_STATUSES)
  status?: string;
}

export class UploadMeetingBodyDto extends CreateMeetingDto {
  @ApiPropertyOptional({
    type: 'string',
    format: 'binary',
    description: 'Optional recording (MP3, WAV, M4A, MP4, WEBM, MOV)',
  })
  file?: unknown;
}

export class UploadTranscriptBodyDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'WebVTT (.vtt), SubRip (.srt), JSON, or timestamped plain text',
  })
  file!: unknown;
}
