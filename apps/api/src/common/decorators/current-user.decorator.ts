import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Role } from '@unipods/types';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

/** Injects the JWT-authenticated user. Only valid behind `JwtAuthGuard`. */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
