import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';

@Injectable()
export class DoctorsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateDoctorDto & { branchId?: string }) {
    return this.prisma.doctor.create({ data: dto });
  }

  async findAll(branchId?: string, includeInactive = false) {
    const where: any = includeInactive ? {} : { isActive: true };
    if (branchId) where.branchId = branchId;
    return this.prisma.doctor.findMany({ where, orderBy: { name: 'asc' } });
  }

  async findOne(id: string, branchId?: string) {
    const doctor = await this.prisma.doctor.findUnique({ where: { id } });
    if (!doctor) throw new NotFoundException(`Doctor ${id} not found`);
    if (branchId && doctor.branchId && doctor.branchId !== branchId) {
      throw new NotFoundException(`Doctor ${id} not found`);
    }
    return doctor;
  }

  async update(id: string, dto: UpdateDoctorDto, branchId?: string) {
    await this.findOne(id, branchId);
    return this.prisma.doctor.update({ where: { id }, data: dto });
  }

  async remove(id: string, branchId?: string) {
    await this.findOne(id, branchId);
    return this.prisma.doctor.update({ where: { id }, data: { isActive: false } });
  }
}
