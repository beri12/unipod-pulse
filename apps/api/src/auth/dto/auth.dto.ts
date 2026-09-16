import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

const normaliseEmail = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value,
);

export class RegisterDto {
  @ApiProperty({ example: 'ada@unipods.dev' })
  @normaliseEmail
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  @IsString()
  @MinLength(2, { message: 'name must be at least 2 characters' })
  @MaxLength(80)
  name!: string;

  @ApiProperty({ minLength: 10, description: 'At least 10 characters' })
  @IsString()
  @MinLength(10, { message: 'password must be at least 10 characters' })
  @MaxLength(200)
  password!: string;
}

export class LoginDto {
  @ApiProperty({ example: 'ada@unipods.dev' })
  @normaliseEmail
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1, { message: 'password is required' })
  @MaxLength(200)
  password!: string;
}

export class RefreshDto {
  @ApiPropertyOptional({ description: 'Refresh token issued by /auth/login' })
  @IsString()
  @MinLength(10)
  @MaxLength(4096)
  refreshToken!: string;
}
