import { PrismaService } from '../prisma/prisma.service';
export declare class PrescriptionsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(customerId: string, doctorName: string, notes: string | undefined, validUntil: string | undefined, file: Express.Multer.File, branchId?: string): Promise<{
        id: string;
        isActive: boolean;
        branchId: string | null;
        createdAt: Date;
        notes: string | null;
        doctorName: string;
        customerId: string;
        imageUrl: string | null;
        validUntil: Date | null;
    }>;
    findByCustomer(customerId: string, branchId?: string): Promise<{
        id: string;
        isActive: boolean;
        branchId: string | null;
        createdAt: Date;
        notes: string | null;
        doctorName: string;
        customerId: string;
        imageUrl: string | null;
        validUntil: Date | null;
    }[]>;
    findOne(id: string, branchId?: string): Promise<{
        id: string;
        isActive: boolean;
        branchId: string | null;
        createdAt: Date;
        notes: string | null;
        doctorName: string;
        customerId: string;
        imageUrl: string | null;
        validUntil: Date | null;
    }>;
    remove(id: string, branchId?: string): Promise<{
        id: string;
        isActive: boolean;
        branchId: string | null;
        createdAt: Date;
        notes: string | null;
        doctorName: string;
        customerId: string;
        imageUrl: string | null;
        validUntil: Date | null;
    }>;
}
