import { CustomerType } from '@prisma/client';
export declare class CreateCustomerDto {
    name: string;
    phone: string;
    alternatePhone?: string;
    email?: string;
    address?: string;
    type?: CustomerType;
    doctorRef?: string;
    creditLimit?: number;
    gstin?: string;
    dlNumber?: string;
    registrationNumber?: string;
    notes?: string;
    referredBy?: string;
}
