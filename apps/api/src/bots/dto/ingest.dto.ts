import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** One captured message from a chat platform. */
export class IngestMessageDto {
  @ApiPropertyOptional({
    description: 'Platform message id, used to avoid importing the same message twice',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalId?: string;

  @ApiProperty({ description: 'Group or channel name the message was posted in' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  channel!: string;

  @ApiProperty({ description: 'Display name of whoever sent it' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  authorName!: string;

  @ApiPropertyOptional({ description: 'Stable platform user id, when the platform exposes one' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  authorId?: string;

  @ApiProperty({ description: 'Message text' })
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  content!: string;

  @ApiProperty({ description: 'When it was sent, ISO 8601' })
  @IsISO8601()
  messageDate!: string;

  @ApiPropertyOptional({ description: 'External id of the message this replies to' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  replyToExternalId?: string;

  @ApiPropertyOptional({ description: 'Treat as an announcement, which ranks higher in catch-up' })
  @IsOptional()
  @IsBoolean()
  isAnnouncement?: boolean;
}

export class IngestMessagesDto {
  @ApiProperty({ type: [IngestMessageDto], description: 'Up to 200 messages per request' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => IngestMessageDto)
  messages!: IngestMessageDto[];
}

export class BotAskDto {
  @ApiProperty({ description: 'The question, as it was asked in the group' })
  @IsString()
  @MinLength(2)
  @MaxLength(2_000)
  question!: string;

  @ApiPropertyOptional({ description: 'Group or channel the question came from, for logging' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  channel?: string;
}
