import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface CachedUser {
  isActive: boolean;
  branchId: string | null;
  expiresAt: number;
}

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  branchId?: string | null;
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
    });
  }

  async validate(payload: JwtPayload) {
    const userId = payload.sub;
    const now = Date.now();
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > now) {
      if (!cached.isActive) {
        throw new UnauthorizedException('User is not active or deleted');
      }
      return {
        userId,
        email: payload.email,
        role: payload.role,
        branchId: cached.branchId,
      };
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      this.cache.delete(userId);
      throw new UnauthorizedException('User is not active or deleted');
    }
    this.cache.set(userId, {
      isActive: user.isActive,
      branchId: user.branchId ?? null,
      expiresAt: now + JwtStrategy.TTL_MS,
    });
    return {
      userId,
      email: payload.email,
      role: payload.role,
      branchId: user.branchId ?? null,
    };
  }
}
