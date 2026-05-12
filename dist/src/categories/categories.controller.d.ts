import type { Response } from 'express';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
export declare class CategoriesController {
    private readonly categoriesService;
    constructor(categoriesService: CategoriesService);
    create(dto: CreateCategoryDto, req: any): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        branchId: string | null;
        createdAt: Date;
        description: string | null;
        color: string | null;
        updatedAt: Date;
    }>;
    findAll(req: any): Promise<{
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
    exportCsv(res: Response, req: any): Promise<void>;
    importCsv(file: Express.Multer.File, req: any): Promise<{
        created: number;
        skipped: number;
        errors: string[];
    }>;
    findOne(id: string, req: any): Promise<{
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
    update(id: string, dto: UpdateCategoryDto, req: any): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        branchId: string | null;
        createdAt: Date;
        description: string | null;
        color: string | null;
        updatedAt: Date;
    }>;
    remove(id: string, req: any): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        branchId: string | null;
        createdAt: Date;
        description: string | null;
        color: string | null;
        updatedAt: Date;
    }>;
}
