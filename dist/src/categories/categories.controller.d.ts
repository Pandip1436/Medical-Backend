import type { Response } from 'express';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
export declare class CategoriesController {
    private readonly categoriesService;
    constructor(categoriesService: CategoriesService);
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
    exportCsv(res: Response): Promise<void>;
    importCsv(file: Express.Multer.File): Promise<{
        created: number;
        skipped: number;
        errors: string[];
    }>;
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
}
