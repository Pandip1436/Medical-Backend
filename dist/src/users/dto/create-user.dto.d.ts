import { Role } from '@prisma/client';
export declare class CreateUserDto {
    name: string;
    email: string;
    phone: string;
    password: string;
    role: Role;
    isActive?: boolean;
}
