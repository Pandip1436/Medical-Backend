import { Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
interface JwtPayload {
    sub: string;
    email: string;
    role: string;
    branchId?: string | null;
}
declare const JwtStrategy_base: new (...args: [opt: import("passport-jwt").StrategyOptionsWithRequest] | [opt: import("passport-jwt").StrategyOptionsWithoutRequest]) => Strategy & {
    validate(...args: any[]): unknown;
};
export declare class JwtStrategy extends JwtStrategy_base {
    private prisma;
    private cache;
    private static readonly TTL_MS;
    constructor(prisma: PrismaService);
    validate(payload: JwtPayload): Promise<{
        userId: string;
        email: string;
        role: string;
        branchId: string | null;
    }>;
}
export {};
