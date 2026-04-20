import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
export declare class BranchesController {
    private readonly branchesService;
    constructor(branchesService: BranchesService);
    create(dto: CreateBranchDto): Promise<{
        id: string;
        email: string | null;
        name: string;
        phone: string | null;
        isActive: boolean;
        createdAt: Date;
        code: string;
        address: string | null;
        gstin: string | null;
        drugLicense: string | null;
        isDefault: boolean;
    }>;
    findAll(): import(".prisma/client").Prisma.PrismaPromise<{
        id: string;
        email: string | null;
        name: string;
        phone: string | null;
        isActive: boolean;
        createdAt: Date;
        code: string;
        address: string | null;
        gstin: string | null;
        drugLicense: string | null;
        isDefault: boolean;
    }[]>;
    findOne(id: string): Promise<{
        id: string;
        email: string | null;
        name: string;
        phone: string | null;
        isActive: boolean;
        createdAt: Date;
        code: string;
        address: string | null;
        gstin: string | null;
        drugLicense: string | null;
        isDefault: boolean;
    }>;
    stats(id: string): Promise<{
        invoiceCount: number;
        invoiceTotal: number;
        expenseTotal: number;
    }>;
    update(id: string, dto: UpdateBranchDto): Promise<{
        id: string;
        email: string | null;
        name: string;
        phone: string | null;
        isActive: boolean;
        createdAt: Date;
        code: string;
        address: string | null;
        gstin: string | null;
        drugLicense: string | null;
        isDefault: boolean;
    }>;
    remove(id: string): Promise<{
        id: string;
        email: string | null;
        name: string;
        phone: string | null;
        isActive: boolean;
        createdAt: Date;
        code: string;
        address: string | null;
        gstin: string | null;
        drugLicense: string | null;
        isDefault: boolean;
    }>;
}
