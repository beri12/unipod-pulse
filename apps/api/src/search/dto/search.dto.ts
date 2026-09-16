import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SOURCE_KINDS, type SourceKind } from '@unipods/types';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class SearchQueryDto {
  @ApiProperty({ example: 'hackathon deadline' })
  @IsString()
  @MaxLength(500)
  q!: string;

  @ApiPropertyOptional({
    enum: SOURCE_KINDS,
    isArray: true,
    description: 'Comma-separated. Omit to search everything.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === '') return undefined;
    const list = Array.isArray(value) ? value : String(value).split(',');
    return list.map((entry) => String(entry).trim().toUpperCase()).filter(Boolean);
  })
  @IsArray()
  @IsIn(SOURCE_KINDS, { each: true })
  types?: SourceKind[];

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    const parsed = Number.parseInt(String(value ?? 20), 10);
    return Number.isFinite(parsed) ? parsed : 20;
  })
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}
