import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  private contactInclude = {
    company: { select: { id: true, name: true } },
    ownerUser: { select: { id: true, name: true, email: true } },
    promotedCustomer: { select: { id: true, name: true } },
  } satisfies Prisma.ContactInclude;

  async findAll(opts: {
    q?: string;
    branchId?: string;
    companyId?: string;
    status?: 'ACTIVE' | 'INACTIVE';
    take?: number;
    skip?: number;
  }) {
    const where: Prisma.ContactWhereInput = {};
    if (opts.branchId) where.branchId = opts.branchId;
    if (opts.companyId) where.companyId = opts.companyId;
    if (opts.status) where.status = opts.status;
    if (opts.q) {
      const q = opts.q;
      where.OR = [
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }
    const take = Math.min(Math.max(opts.take ?? 50, 1), 200);
    const skip = Math.max(opts.skip ?? 0, 0);
    const [data, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        include: this.contactInclude,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.contact.count({ where }),
    ]);
    return { data, total, hasMore: skip + data.length < total };
  }

  async findOne(id: string, branchId?: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
      include: this.contactInclude,
    });
    if (!contact) throw new NotFoundException('Contact not found');
    if (branchId && contact.branchId !== branchId) {
      throw new NotFoundException('Contact not found');
    }
    return contact;
  }

  /**
   * Used by IndiaMART sync to find-or-create a contact off (phone, email).
   * Phone match wins; falls back to email. Returns null if neither was given.
   */
  async findByPhoneOrEmail(
    branchId: string,
    opts: { phone?: string; email?: string },
  ) {
    if (opts.phone) {
      const byPhone = await this.prisma.contact.findUnique({
        where: { branchId_phone: { branchId, phone: opts.phone } },
      });
      if (byPhone) return byPhone;
    }
    if (opts.email) {
      const byEmail = await this.prisma.contact.findFirst({
        where: { branchId, email: opts.email },
      });
      if (byEmail) return byEmail;
    }
    return null;
  }

  async create(
    dto: CreateContactDto,
    ctx: { branchId: string; userId: string },
  ) {
    if (!ctx.branchId) {
      throw new BadRequestException('branchId is required to create a contact');
    }
    // Manually enforce per-branch phone uniqueness so we can return a friendlier
    // error than P2002.
    const existing = await this.prisma.contact.findUnique({
      where: { branchId_phone: { branchId: ctx.branchId, phone: dto.phone } },
    });
    if (existing) {
      throw new ConflictException(
        `Contact with phone ${dto.phone} already exists in this branch`,
      );
    }

    return this.prisma.contact.create({
      data: {
        firstName: dto.firstName.trim(),
        lastName: dto.lastName ?? null,
        phoneCountryCode: dto.phoneCountryCode ?? '+91',
        phone: dto.phone,
        email: dto.email ?? null,
        jobTitle: dto.jobTitle ?? null,
        address: dto.address ?? null,
        city: dto.city ?? null,
        state: dto.state ?? null,
        country: dto.country ?? null,
        countryIso: dto.countryIso ?? null,
        source: dto.source ?? 'MANUAL',
        status: dto.status ?? 'ACTIVE',
        notes: dto.notes ?? null,
        ownerUser: { connect: { id: dto.ownerUserId ?? ctx.userId } },
        branch: { connect: { id: ctx.branchId } },
        ...(dto.companyId && {
          company: { connect: { id: dto.companyId } },
        }),
      },
      include: this.contactInclude,
    });
  }

  async update(id: string, dto: UpdateContactDto, branchId?: string) {
    await this.findOne(id, branchId);
    const data: Prisma.ContactUpdateInput = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.phoneCountryCode !== undefined) data.phoneCountryCode = dto.phoneCountryCode;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.jobTitle !== undefined) data.jobTitle = dto.jobTitle;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.state !== undefined) data.state = dto.state;
    if (dto.country !== undefined) data.country = dto.country;
    if (dto.countryIso !== undefined) data.countryIso = dto.countryIso;
    if (dto.source !== undefined) data.source = dto.source;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.ownerUserId !== undefined) {
      data.ownerUser = { connect: { id: dto.ownerUserId } };
    }
    if (dto.companyId !== undefined) {
      data.company = dto.companyId
        ? { connect: { id: dto.companyId } }
        : { disconnect: true };
    }
    return this.prisma.contact.update({
      where: { id },
      data,
      include: this.contactInclude,
    });
  }

  async remove(id: string, branchId?: string) {
    await this.findOne(id, branchId);
    // Restrict if the contact has open leads — caller should remove or
    // reassign those first.
    const leadCount = await this.prisma.lead.count({ where: { contactId: id } });
    if (leadCount > 0) {
      throw new BadRequestException(
        `Contact has ${leadCount} lead(s) — reassign or delete those first`,
      );
    }
    return this.prisma.contact.delete({ where: { id } });
  }
}
