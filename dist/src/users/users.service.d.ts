import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
export declare class UsersService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(createUserDto: CreateUserDto): Promise<{
        id: string;
        email: string;
        name: string;
        phone: string;
        role: import(".prisma/client").$Enums.Role;
        isActive: boolean;
        lastLogin: Date | null;
        branchId: string | null;
        createdAt: Date;
        branch: {
            id: string;
            name: string;
            code: string;
        } | null;
    }>;
    findAll(branchId?: string): import(".prisma/client").Prisma.PrismaPromise<{
        id: string;
        email: string;
        name: string;
        phone: string;
        role: import(".prisma/client").$Enums.Role;
        isActive: boolean;
        lastLogin: Date | null;
        branchId: string | null;
        branch: {
            id: string;
            name: string;
            code: string;
        } | null;
    }[]>;
    findOne(id: string, branchId?: string): Promise<{
        id: string;
        email: string;
        name: string;
        phone: string;
        role: import(".prisma/client").$Enums.Role;
        isActive: boolean;
        lastLogin: Date | null;
        branchId: string | null;
        createdAt: Date;
        branch: {
            id: string;
            name: string;
            code: string;
        } | null;
    }>;
    update(id: string, updateUserDto: UpdateUserDto, branchId?: string): Promise<{
        id: string;
        email: string;
        name: string;
        phone: string;
        role: import(".prisma/client").$Enums.Role;
        isActive: boolean;
        branchId: string | null;
        branch: {
            id: string;
            name: string;
            code: string;
        } | null;
    }>;
    remove(id: string, branchId?: string): Promise<{
        password: string;
        id: string;
        email: string;
        name: string;
        phone: string;
        role: import(".prisma/client").$Enums.Role;
        isActive: boolean;
        lastLogin: Date | null;
        branchId: string | null;
        commissionRate: import("@prisma/client/runtime/library").Decimal;
        createdAt: Date;
    }>;
}
