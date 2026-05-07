import type { Request } from 'express';

// Shape produced by JwtStrategy.validate() — attached to req.user when a
// route is guarded by JwtAuthGuard.
export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: string;
  // jwt.strategy emits null for users with no branch; downstream services
  // accept `string | undefined`, so callers should coerce with `?? undefined`.
  branchId?: string | null;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
