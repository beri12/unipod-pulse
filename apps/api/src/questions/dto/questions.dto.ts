import { ApiPropertyOptional } from '@nestjs/swagger';
import { QUESTION_STATUSES, type QuestionStatus } from '@unipods/types';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class ListUnansweredQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: QUESTION_STATUSES })
  @IsOptional()
  @IsIn(QUESTION_STATUSES)
  status?: QuestionStatus;
}

export class ListQuestionLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === '' ? undefined : /^(1|true|yes)$/i.test(String(value)),
  )
  @IsBoolean()
  answered?: boolean;
}

export class UpdateQuestionStatusDto {
  @ApiPropertyOptional({ enum: QUESTION_STATUSES })
  @IsIn(QUESTION_STATUSES)
  status!: QuestionStatus;

  @ApiPropertyOptional({ description: 'How the gap was closed' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  resolutionNote?: string;
}
