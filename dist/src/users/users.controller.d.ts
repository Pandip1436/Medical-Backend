import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
export declare class UsersController {
    private readonly usersService;
    constructor(usersService: UsersService);
    create(createUserDto: CreateUserDto, req: any): Promise<{
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
    findAll(req: any, branchId?: string): import(".prisma/client").Prisma.PrismaPromise<{
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
    findOne(id: string, req: any): Promise<{
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
    update(id: string, updateUserDto: UpdateUserDto, req: any): Promise<{
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
    remove(id: string, req: any): Promise<{
        password: string;
        id: string;
        email: string;
        name: string;
        phone: string;
        role: import(".prisma/client").$Enums.Role;
        isActive: boolean;
        lastLogin: Date | null;
        branchId: string | null;
        createdAt: Date;
    }>;
}
