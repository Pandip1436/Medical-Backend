import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
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
    getProfile(req: AuthenticatedRequest): Promise<{
        id: string;
        email: string;
        name: string;
        role: import(".prisma/client").$Enums.Role;
        isActive: boolean;
        branchId: string | null;
    } | null>;
}
