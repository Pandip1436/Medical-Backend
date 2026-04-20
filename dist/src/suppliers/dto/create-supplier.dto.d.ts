import { PaymentTerms } from '@prisma/client';
export declare class CreateSupplierDto {
    name: string;
    contactPerson: string;
    phone: string;
    email: string;
    gstin: string;
    drugLicense: string;
    address: string;
    paymentTerms: PaymentTerms;
    bankDetails?: string;
    isActive?: boolean;
    branchId?: string;
}
