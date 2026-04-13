import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
export declare class UsersController {
    private readonly usersService;
    constructor(usersService: UsersService);
    create(createUserDto: CreateUserDto): Promise<{
        id: string;
        email: string;
        name: string;
        phone: string;
        role: import(".prisma/client").$Enums.Role;
        isActive: boolean;
        lastLogin: Date | null;
        createdAt: Date;
    }>;
    findAll(): import(".prisma/client").Prisma.PrismaPromise<{
        id: string;
        email: string;
        name: string;
        phone: string;
        role: import(".prisma/client").$Enums.Role;
        isActive: boolean;
        lastLogin: Date | null;
    }[]>;
    findOne(id: string): Promise<{
        id: string;
        email: string;
        name: string;
        phone: string;
        role: import(".prisma/client").$Enums.Role;
        isActive: boolean;
        lastLogin: Date | null;
        createdAt: Date;
    }>;
    update(id: string, updateUserDto: UpdateUserDto): Promise<{
        id: string;
        email: string;
        name: string;
        phone: string;
        role: import(".prisma/client").$Enums.Role;
        isActive: boolean;
    }>;
    remove(id: string): Promise<{
        password: string;
        id: string;
        email: string;
        name: string;
        phone: string;
        role: import(".prisma/client").$Enums.Role;
        isActive: boolean;
        lastLogin: Date | null;
        createdAt: Date;
    }>;
}
