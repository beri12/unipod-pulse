import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '@unipods/config';
import type { AuthResponse, PublicUser, Role } from '@unipods/types';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { AppException, ERROR_CODES } from '../common/errors';
import { StructuredLogger } from '../common/logger';
import { ENV } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import type { LoginDto, RegisterDto } from './dto/auth.dto';
import type { JwtPayload } from './jwt.strategy';

/**
 * `@nestjs/jwt` types `expiresIn` as a literal union of duration strings, which
 * a value read from the environment can never satisfy. The value is validated
 * by `parseDuration` instead, so the cast is narrowed to this one helper.
 */
type ExpiresIn = Parameters<JwtService['signAsync']>[1] extends infer O
  ? O extends { expiresIn?: infer E }
    ? E
    : never
  : never;

function expiresIn(value: string): ExpiresIn {
  return value as ExpiresIn;
}

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly logger: StructuredLogger,
  ) {}

  async register(dto: RegisterDto, userAgent?: string): Promise<AuthResponse> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw AppException.conflict(
        'An account with this email already exists.',
        ERROR_CODES.EMAIL_TAKEN,
      );
    }

    // The very first account becomes the administrator so a fresh deployment is
    // usable; every later sign-up is a regular member.
    const isFirstUser = (await this.prisma.user.count()) === 0;
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name.trim(),
        passwordHash: await hash(dto.password, BCRYPT_ROUNDS),
        role: isFirstUser ? 'ADMIN' : 'USER',
      },
    });

    this.logger.event('log', 'user registered', { userId: user.id, role: user.role });
    return this.issueTokens(user, userAgent);
  }

  async login(dto: LoginDto, userAgent?: string): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    // Always run a comparison so a missing account and a wrong password take a
    // similar amount of time.
    const passwordMatches = await compare(
      dto.password,
      user?.passwordHash ?? '$2a$12$0000000000000000000000000000000000000000000000000000',
    );
    if (!user || !passwordMatches) {
      throw new AppException(
        ERROR_CODES.INVALID_CREDENTIALS,
        'That email and password combination is not correct.',
        401,
      );
    }
    return this.issueTokens(user, userAgent);
  }

  /**
   * Rotates the refresh token: the presented token is revoked and a new one
   * issued. Presenting an already-revoked token invalidates the whole family,
   * which is the standard detection for a stolen token being replayed.
   */
  async refresh(refreshToken: string, userAgent?: string): Promise<AuthResponse> {
    let payload: { sub: string; type?: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, { secret: this.env.JWT_REFRESH_SECRET });
    } catch {
      throw new AppException(ERROR_CODES.TOKEN_EXPIRED, 'Your session has expired.', 401);
    }
    if (payload.type !== 'refresh') {
      throw AppException.unauthorized('Invalid token type.');
    }

    const tokenHash = hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.userId !== payload.sub) {
      throw AppException.unauthorized('This session is no longer valid.');
    }
    if (stored.revokedAt || stored.expiresAt < new Date()) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.warn('Refresh token replay detected; all sessions revoked', {
        userId: stored.userId,
      });
      throw AppException.unauthorized('This session is no longer valid. Please sign in again.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user) throw AppException.unauthorized('This account no longer exists.');

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(user, userAgent);
  }

  async logout(refreshToken: string | undefined, userId: string): Promise<void> {
    if (refreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(refreshToken), userId },
        data: { revokedAt: new Date() },
      });
      return;
    }
    // No token supplied — end every session for this user.
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppException.notFound('Your account');
    return toPublicUser(user);
  }

  private async issueTokens(
    user: { id: string; email: string; name: string; role: Role; avatarUrl: string | null; createdAt: Date },
    userAgent?: string,
  ): Promise<AuthResponse> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      type: 'access',
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.env.JWT_SECRET,
      expiresIn: expiresIn(this.env.JWT_EXPIRES_IN),
    });

    // A random jti keeps two refresh tokens issued in the same second distinct,
    // so the unique hash constraint cannot collide.
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, type: 'refresh', jti: randomBytes(16).toString('hex') },
      { secret: this.env.JWT_REFRESH_SECRET, expiresIn: expiresIn(this.env.JWT_REFRESH_EXPIRES_IN) },
    );

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + parseDuration(this.env.JWT_REFRESH_EXPIRES_IN)),
        userAgent: userAgent?.slice(0, 200) ?? null,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(parseDuration(this.env.JWT_EXPIRES_IN) / 1000),
      user: toPublicUser(user),
    };
  }
}

/** Refresh tokens are stored hashed so a database leak cannot resume sessions. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function toPublicUser(user: {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  role: Role;
  createdAt: Date;
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl ?? null,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Parses `15m` / `7d` / `3600` into milliseconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*([smhdw]?)$/i.exec(value.trim());
  if (!match) return 15 * 60 * 1000;
  const amount = Number.parseInt(match[1] as string, 10);
  const unit = (match[2] || 's').toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  return amount * (multipliers[unit] ?? 1_000);
}
