import type { Request } from 'express';
export interface AuthenticatedUser {
    userId: string;
    email: string;
    role: string;
    branchId?: string | null;
}
export interface AuthenticatedRequest extends Request {
    user: AuthenticatedUser;
}
