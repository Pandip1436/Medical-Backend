import { DoctorsService } from './doctors.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
export declare class DoctorsController {
    private readonly doctorsService;
    constructor(doctorsService: DoctorsService);
    create(dto: CreateDoctorDto, req: any, branchId?: string): Promise<{
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
    findAll(req: any, branchId?: string, includeInactive?: string): Promise<{
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
    findOne(id: string, req: any): Promise<{
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
    update(id: string, dto: UpdateDoctorDto, req: any): Promise<{
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
    remove(id: string, req: any): Promise<{
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
