import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

interface CachedUser {
  isActive: boolean;
  homeBranchId: string | null;
  branchIds: string[];
  roles: string[];
  expiresAt: number;
}

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  roles?: string[];
  branchId?: string | null;
  branchIds?: string[];
  isSuperAdmin?: boolean;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  // Short-lived in-memory cache for the user-validation lookup. Without this
  // every guarded request hits Postgres, which exhausts the Neon pool the
  // moment the FE fans out parallel calls on a page load. 30s is the worst
  // case for a deactivated user staying authorised — acceptable tradeoff for
  // the load reduction.
  private cache = new Map<string, CachedUser>();
  private static readonly TTL_MS = 30_000;

  constructor(private prisma: PrismaService) {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET environment variable is not set');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      passReqToCallback: true,
    });
  }

  // Resolves the effective active branch from the branchId the frontend
  // injected (req.query.branchId), validated against the user's allowed set.
  // This is what enforces multi-branch access: a user may switch among their
  // assigned branches, but a forged out-of-set id silently falls back to home.
  private resolveBranch(
    req: Request,
    homeBranchId: string | null,
    branchIds: string[],
    superAdmin: boolean,
  ): string | null {
    const raw = req?.query?.branchId;
    const requested = Array.isArray(raw) ? String(raw[0]) : (raw ? String(raw) : null);
    if (superAdmin) {
      // Global admin may view any branch; no request = all branches (null).
      return requested ?? null;
    }
    if (requested && branchIds.includes(requested)) return requested;
    return homeBranchId ?? branchIds[0] ?? null;
  }

  async validate(req: Request, payload: JwtPayload) {
    const userId = payload.sub;
    const now = Date.now();
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > now) {
      if (!cached.isActive) {
        throw new UnauthorizedException('User is not active or deleted');
      }
      const superAdmin = cached.roles.includes('SUPER_ADMIN');
      return {
        userId,
        email: payload.email,
        role: payload.role,
        roles: cached.roles,
        branchId: this.resolveBranch(req, cached.homeBranchId, cached.branchIds, superAdmin),
        homeBranchId: cached.homeBranchId,
        branchIds: cached.branchIds,
        isSuperAdmin: superAdmin,
      };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { branchAccess: { select: { branchId: true } } },
    });
    if (!user || !user.isActive) {
      this.cache.delete(userId);
      throw new UnauthorizedException('User is not active or deleted');
    }
    const dbRoles = user.roles?.length ? user.roles : [user.role];
    const branchIds = user.branchAccess.map((b) => b.branchId);
    const superAdmin = dbRoles.includes('SUPER_ADMIN');
    this.cache.set(userId, {
      isActive: user.isActive,
      homeBranchId: user.branchId ?? null,
      branchIds,
      roles: dbRoles,
      expiresAt: now + JwtStrategy.TTL_MS,
    });
    return {
      userId,
      email: payload.email,
      role: user.role,
      roles: dbRoles,
      branchId: this.resolveBranch(req, user.branchId ?? null, branchIds, superAdmin),
      homeBranchId: user.branchId ?? null,
      branchIds,
      isSuperAdmin: superAdmin,
    };
  }
}
