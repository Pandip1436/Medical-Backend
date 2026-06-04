import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest();
    // SUPER_ADMIN satisfies every gate. Otherwise check the user's full role
    // set (falling back to the singular `role` for legacy tokens).
    const userRoles: string[] = user?.roles?.length ? user.roles : [user?.role];
    if (userRoles.includes('SUPER_ADMIN')) return true;
    return requiredRoles.some((role) => userRoles.includes(role));
  }
}
