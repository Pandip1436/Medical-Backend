import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(opts: { q?: string; branchId?: string; take?: number; skip?: number }) {
    const where: Prisma.CompanyWhereInput = {};
    if (opts.branchId) where.branchId = opts.branchId;
    if (opts.q) {
      where.OR = [
        { name: { contains: opts.q, mode: 'insensitive' } },
        { industry: { contains: opts.q, mode: 'insensitive' } },
        { city: { contains: opts.q, mode: 'insensitive' } },
      ];
    }
    const take = Math.min(Math.max(opts.take ?? 50, 1), 200);
    const skip = Math.max(opts.skip ?? 0, 0);
    const [data, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        take,
        skip,
        orderBy: { name: 'asc' },
      }),
      this.prisma.company.count({ where }),
    ]);
    return { data, total, hasMore: skip + data.length < total };
  }

  async findOne(id: string, branchId?: string) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException('Company not found');
    if (branchId && company.branchId !== branchId) {
      throw new NotFoundException('Company not found');
    }
    return company;
  }

  async create(dto: CreateCompanyDto, branchId: string) {
    if (!branchId) {
      throw new BadRequestException('branchId is required to create a company');
    }
    return this.prisma.company.create({
      data: {
        name: dto.name.trim(),
        website: dto.website,
        industry: dto.industry,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        country: dto.country,
        branchId,
      },
    });
  }

  async update(id: string, dto: UpdateCompanyDto, branchId?: string) {
    await this.findOne(id, branchId);
    const data: Prisma.CompanyUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.website !== undefined) data.website = dto.website;
    if (dto.industry !== undefined) data.industry = dto.industry;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.state !== undefined) data.state = dto.state;
    if (dto.country !== undefined) data.country = dto.country;
    return this.prisma.company.update({ where: { id }, data });
  }

  async remove(id: string, branchId?: string) {
    await this.findOne(id, branchId);
    return this.prisma.company.delete({ where: { id } });
  }
}
