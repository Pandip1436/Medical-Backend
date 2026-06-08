import { ForbiddenException } from '@nestjs/common';

/**
 * Resolves the branch id that branch-scoped list/read queries MUST be filtered
 * by, enforcing multi-tenant isolation centrally.
 *
 * Rules:
 *  - SUPER_ADMIN: may view any branch. Returns the resolved active branch
 *    (`user.branchId`, already populated from the validated `?branchId=` query
 *    by JwtStrategy) or `undefined` (= all branches) when none is selected.
 *  - Every other role: locked to their own resolved branch. The raw client
 *    `?branchId=` query param is intentionally NOT honored here — JwtStrategy
 *    already validated it against the user's allowed set and folded the result
 *    into `user.branchId`, so that is the single source of truth.
 *
 * A non-super-admin with no assigned branch is refused rather than silently
 * scoped to "all branches" (which would leak every tenant's data).
 */
export function resolveBranchScope(user: {
  isSuperAdmin?: boolean;
  role?: string;
  roles?: string[];
  branchId?: string | null;
}): string | undefined {
  const isSuper =
    user?.isSuperAdmin === true ||
    user?.role === 'SUPER_ADMIN' ||
    (user?.roles ?? []).includes('SUPER_ADMIN');

  if (isSuper) {
    return user?.branchId ?? undefined;
  }

  if (!user?.branchId) {
    throw new ForbiddenException('Your account is not assigned to a branch.');
  }
  return user.branchId;
}
