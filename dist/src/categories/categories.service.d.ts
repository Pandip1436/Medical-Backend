import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
export declare class CategoriesService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(dto: CreateCategoryDto): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        createdAt: Date;
        description: string | null;
        color: string | null;
        updatedAt: Date;
    }>;
    findAll(): Promise<{
        productCount: number;
        _count: {
            products: number;
        };
        id: string;
        name: string;
        isActive: boolean;
        createdAt: Date;
        description: string | null;
        color: string | null;
        updatedAt: Date;
    }[]>;
    findOne(id: string): Promise<{
        productCount: number;
        _count: {
            products: number;
        };
        id: string;
        name: string;
        isActive: boolean;
        createdAt: Date;
        description: string | null;
        color: string | null;
        updatedAt: Date;
    }>;
    update(id: string, dto: UpdateCategoryDto): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        createdAt: Date;
        description: string | null;
        color: string | null;
        updatedAt: Date;
    }>;
    remove(id: string): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        createdAt: Date;
        description: string | null;
        color: string | null;
        updatedAt: Date;
    }>;
    exportCsv(): Promise<string>;
    importCsv(buffer: Buffer): Promise<{
        created: number;
        skipped: number;
        errors: string[];
    }>;
}
