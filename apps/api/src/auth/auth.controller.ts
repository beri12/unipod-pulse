import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  // Sign-up and sign-in are rate limited harder than ordinary routes.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  @ApiOperation({ summary: 'Create an account. The first account created becomes the admin.' })
  register(@Body() dto: RegisterDto, @Req() request: Request) {
    return this.auth.register(dto, request.headers['user-agent']);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange email and password for an access + refresh token' })
  login(@Body() dto: LoginDto, @Req() request: Request) {
    return this.auth.login(dto, request.headers['user-agent']);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token for a new token pair' })
  refresh(@Body() dto: RefreshDto, @Req() request: Request) {
    return this.auth.refresh(dto.refreshToken, request.headers['user-agent']);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the supplied refresh token, or every session when omitted' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: Partial<RefreshDto>,
  ): Promise<void> {
    await this.auth.logout(body?.refreshToken, user.id);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOkResponse({ description: 'The authenticated user' })
  @ApiOperation({ summary: 'Current user' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }
}
