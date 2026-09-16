import { CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@unipods/types';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { AppException } from '../../common/errors';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) throw AppException.unauthorized();
    if (!required.includes(user.role)) {
      throw AppException.forbidden('This action requires an administrator account.');
    }
    return true;
  }
}
