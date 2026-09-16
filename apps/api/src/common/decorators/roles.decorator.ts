import { SetMetadata } from '@nestjs/common';
import type { Role } from '@unipods/types';

export const ROLES_KEY = 'unipods:roles';

/** Restricts a route to the listed roles. Enforced by `RolesGuard`. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
