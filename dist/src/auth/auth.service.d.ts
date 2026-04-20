import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
export declare class AuthService {
    private prisma;
    private jwtService;
    constructor(prisma: PrismaService, jwtService: JwtService);
    login(loginDto: LoginDto): Promise<{
        success: boolean;
        data: {
            user: {
                id: string;
                name: string;
                email: string;
                role: import(".prisma/client").$Enums.Role;
                branchId: string | null;
                branch: {
                    id: string;
                    name: string;
                    code: string;
                } | null;
            };
            accessToken: {
                token: string;
                expiresIn: string;
            };
        };
    }>;
    register(registerDto: RegisterDto): Promise<{
        success: boolean;
        data: {
            user: {
                id: string;
                name: string;
                email: string;
                role: import(".prisma/client").$Enums.Role;
            };
            accessToken: {
                token: string;
                expiresIn: string;
            };
        };
        message: string;
    }>;
    validateUser(userId: string): Promise<{
        id: string;
        email: string;
        name: string;
        role: import(".prisma/client").$Enums.Role;
        isActive: boolean;
        branchId: string | null;
    } | null>;
}
