import { PrescriptionsService } from './prescriptions.service';
export declare class PrescriptionsController {
    private readonly svc;
    constructor(svc: PrescriptionsService);
    upload(file: Express.Multer.File, customerId: string, doctorName: string, req: any, notes?: string, validUntil?: string, bodyBranchId?: string): Promise<{
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
    findByCustomer(customerId: string, req: any, branchId?: string): Promise<{
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
    findOne(id: string, req: any): Promise<{
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
    remove(id: string, req: any): Promise<{
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
