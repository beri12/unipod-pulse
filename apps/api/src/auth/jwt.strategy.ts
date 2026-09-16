import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { Env } from '@unipods/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AppException, ERROR_CODES } from '../common/errors';
import { ENV } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: 'USER' | 'ADMIN';
  type: 'access';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @Inject(ENV) env: Env,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: env.JWT_SECRET,
    });
  }

  /**
   * The user row is re-read on every request so a deleted or role-changed
   * account loses access immediately rather than at token expiry.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (payload.type !== 'access') {
      throw new AppException(ERROR_CODES.UNAUTHORIZED, 'Invalid token type.', 401);
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, role: true },
    });
    if (!user) {
      throw new AppException(ERROR_CODES.UNAUTHORIZED, 'This account no longer exists.', 401);
    }
    return user;
  }
}
