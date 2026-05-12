import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
export declare class CategoriesService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    private branchScope;
    private assertNameAvailable;
    create(dto: CreateCategoryDto, branchId?: string): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        branchId: string | null;
        createdAt: Date;
        description: string | null;
        color: string | null;
        updatedAt: Date;
    }>;
    findAll(branchId?: string): Promise<{
        productCount: number;
        _count: {
            products: number;
        };
        id: string;
        name: string;
        isActive: boolean;
        branchId: string | null;
        createdAt: Date;
        description: string | null;
        color: string | null;
        updatedAt: Date;
    }[]>;
    findOne(id: string, branchId?: string): Promise<{
        productCount: number;
        _count: {
            products: number;
        };
        id: string;
        name: string;
        isActive: boolean;
        branchId: string | null;
        createdAt: Date;
        description: string | null;
        color: string | null;
        updatedAt: Date;
    }>;
    update(id: string, dto: UpdateCategoryDto, branchId?: string): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        branchId: string | null;
        createdAt: Date;
        description: string | null;
        color: string | null;
        updatedAt: Date;
    }>;
    remove(id: string, branchId?: string): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        branchId: string | null;
        createdAt: Date;
        description: string | null;
        color: string | null;
        updatedAt: Date;
    }>;
    exportCsv(branchId?: string): Promise<string>;
    importCsv(buffer: Buffer, branchId?: string): Promise<{
        created: number;
        skipped: number;
        errors: string[];
    }>;
}
