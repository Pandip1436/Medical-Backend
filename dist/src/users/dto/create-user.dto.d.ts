import { Role } from '@prisma/client';
export declare class CreateUserDto {
    name: string;
    email: string;
    phone: string;
    password: string;
    role: Role;
    branchId?: string;
    isActive?: boolean;
    commissionRate?: number;
}
