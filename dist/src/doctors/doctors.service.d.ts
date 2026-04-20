import { PrismaService } from '../prisma/prisma.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
export declare class DoctorsService {
    private prisma;
    constructor(prisma: PrismaService);
    create(dto: CreateDoctorDto & {
        branchId?: string;
    }): Promise<{
        id: string;
        email: string | null;
        name: string;
        phone: string;
        isActive: boolean;
        branchId: string | null;
        createdAt: Date;
        address: string | null;
        specialization: string;
        regNumber: string | null;
    }>;
    findAll(branchId?: string, includeInactive?: boolean): Promise<{
        id: string;
        email: string | null;
        name: string;
        phone: string;
        isActive: boolean;
        branchId: string | null;
        createdAt: Date;
        address: string | null;
        specialization: string;
        regNumber: string | null;
    }[]>;
    findOne(id: string, branchId?: string): Promise<{
        id: string;
        email: string | null;
        name: string;
        phone: string;
        isActive: boolean;
        branchId: string | null;
        createdAt: Date;
        address: string | null;
        specialization: string;
        regNumber: string | null;
    }>;
    update(id: string, dto: UpdateDoctorDto, branchId?: string): Promise<{
        id: string;
        email: string | null;
        name: string;
        phone: string;
        isActive: boolean;
        branchId: string | null;
        createdAt: Date;
        address: string | null;
        specialization: string;
        regNumber: string | null;
    }>;
    remove(id: string, branchId?: string): Promise<{
        id: string;
        email: string | null;
        name: string;
        phone: string;
        isActive: boolean;
        branchId: string | null;
        createdAt: Date;
        address: string | null;
        specialization: string;
        regNumber: string | null;
    }>;
}
