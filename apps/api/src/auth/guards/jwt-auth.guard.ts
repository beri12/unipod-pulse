import { type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AppException, ERROR_CODES } from '../../common/errors';

/**
 * Applied globally: every route requires a valid access token unless it is
 * explicitly marked `@Public()`. Defaulting to "protected" means a new endpoint
 * cannot accidentally expose community knowledge.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<TUser>(error: unknown, user: TUser, info: unknown): TUser {
    if (error || !user) {
      const reason = (info as Error | undefined)?.name;
      if (reason === 'TokenExpiredError') {
        throw new AppException(
          ERROR_CODES.TOKEN_EXPIRED,
          'Your session has expired. Please sign in again.',
          401,
        );
      }
      throw AppException.unauthorized('A valid access token is required.');
    }
    return user;
  }
}
