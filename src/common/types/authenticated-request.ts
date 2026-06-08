import type { Request } from 'express';

// Shape produced by JwtStrategy.validate() — attached to req.user when a
// route is guarded by JwtAuthGuard.
export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: string;
  // Full role set (drives RBAC). Falls back to [role] for legacy tokens.
  roles?: string[];
  // jwt.strategy emits null for users with no branch; downstream services
  // accept `string | undefined`, so callers should coerce with `?? undefined`.
  // For a non-super-admin this is the resolved + validated active branch; for a
  // SUPER_ADMIN it is the requested branch, or null = all branches.
  branchId?: string | null;
  // The user's home/default branch and full allowed-branch set.
  homeBranchId?: string | null;
  branchIds?: string[];
  // True when the user holds SUPER_ADMIN — bypasses branch isolation.
  isSuperAdmin?: boolean;
  // Display name (present on the JWT payload-derived user).
  name?: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
