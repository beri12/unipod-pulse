import { ApiPropertyOptional } from '@nestjs/swagger';
import { PAGINATION_DEFAULTS } from '@unipods/config';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const toInt = (fallback: number) =>
  Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  });

export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: PAGINATION_DEFAULTS.page })
  @toInt(PAGINATION_DEFAULTS.page)
  @IsInt()
  @Min(1)
  page: number = PAGINATION_DEFAULTS.page;

  @ApiPropertyOptional({ minimum: 1, maximum: PAGINATION_DEFAULTS.maxLimit, default: PAGINATION_DEFAULTS.limit })
  @toInt(PAGINATION_DEFAULTS.limit)
  @IsInt()
  @Min(1)
  @Max(PAGINATION_DEFAULTS.maxLimit)
  limit: number = PAGINATION_DEFAULTS.limit;

  @ApiPropertyOptional({ description: 'Free-text filter' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

export function paginate<T>(items: T[], total: number, page: number, limit: number) {
  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}
