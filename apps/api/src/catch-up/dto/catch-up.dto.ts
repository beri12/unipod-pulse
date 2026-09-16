import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';

export class CatchUpQueryDto {
  @ApiPropertyOptional({ example: '2026-09-16', description: 'A single day. Defaults to today.' })
  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'date must be an ISO 8601 date' })
  date?: string;

  @ApiPropertyOptional({ description: 'Start of a custom range' })
  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'from must be an ISO 8601 date' })
  from?: string;

  @ApiPropertyOptional({ description: 'End of a custom range' })
  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'to must be an ISO 8601 date' })
  to?: string;
}
