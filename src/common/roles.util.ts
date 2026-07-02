import { Role } from '@prisma/client';

// Highest privilege first. Used to derive the singular "primary" role kept on
// User.role (for display/behaviour consumers) from the full `roles` set.
export const ROLE_PRECEDENCE: Role[] = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.PHARMACIST,
  Role.INVENTORY_MANAGER,
  Role.ACCOUNTANT,
  Role.SALESPERSON,
  Role.DELIVERY,
];

/** Returns the highest-precedence role from a set, falling back to PHARMACIST. */
export function primaryRole(roles: Role[] | undefined | null): Role {
  if (!roles || roles.length === 0) return Role.PHARMACIST;
  return (
    ROLE_PRECEDENCE.find((r) => roles.includes(r)) ?? roles[0]
  );
}

export function isSuperAdmin(roles: Role[] | undefined | null): boolean {
  return !!roles && roles.includes(Role.SUPER_ADMIN);
}

/** True for both branch admins and super admins — use for "admin-or-above" gates. */
export function isAdminRole(role: string | undefined | null): boolean {
  return role === Role.ADMIN || role === Role.SUPER_ADMIN;
}
