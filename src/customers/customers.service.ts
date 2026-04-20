import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  create(createCustomerDto: CreateCustomerDto & { branchId?: string }) {
    return this.prisma.customer.create({ data: createCustomerDto });
  }

  findAll(query?: string, branchId?: string) {
    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (query) {
      where.OR = [
        { name: { contains: query, mode: 'insensitive' } },
        { phone: { contains: query } },
      ];
    }
    return this.prisma.customer.findMany({ where });
  }

  async findOne(id: string, branchId?: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        prescriptions: true,
        invoices: { take: 10, orderBy: { date: 'desc' } },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    if (branchId && customer.branchId && customer.branchId !== branchId) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  async update(id: string, updateCustomerDto: UpdateCustomerDto, branchId?: string) {
    await this.findOne(id, branchId);
    return this.prisma.customer.update({ where: { id }, data: updateCustomerDto });
  }

  async remove(id: string, branchId?: string) {
    await this.findOne(id, branchId);
    return this.prisma.customer.delete({ where: { id } });
  }

  async recordPayment(id: string, amount: number, paymentMode: string, referenceNumber?: string, branchId?: string) {
    const customer = await this.findOne(id, branchId);
    const newOutstanding = Math.max(0, Number(customer.currentOutstanding) - amount);
    await this.prisma.customer.update({
      where: { id },
      data: { currentOutstanding: newOutstanding },
    });
    return { success: true, customerId: id, amountRecorded: amount, newOutstanding };
  }
}
