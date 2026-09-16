import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ChatRequestDto {
  @ApiPropertyOptional({ description: 'Continue an existing conversation' })
  @IsOptional()
  @IsUUID('4')
  conversationId?: string;

  @ApiProperty({ example: 'When is the team declaration deadline?' })
  @IsString()
  @MinLength(2, { message: 'message must be at least 2 characters' })
  @MaxLength(2000, { message: 'message must be at most 2000 characters' })
  message!: string;
}
