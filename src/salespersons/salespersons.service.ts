import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SalespersonsService {
  constructor(private prisma: PrismaService) {}

  async findAll(branchId?: string) {
    return this.prisma.user.findMany({
      where: {
        role: 'SALESPERSON',
        ...(branchId ? { branchId } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isActive: true,
        commissionRate: true,
        branchId: true,
        lastLogin: true,
        createdAt: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async getStats(id: string, branchId?: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        salespersonId: id,
        ...(branchId ? { branchId } : {}),
        status: { notIn: ['CANCELLED', 'RETURNED'] },
      },
      select: {
        grandTotal: true,
        status: true,
        date: true,
        customerName: true,
        invoiceNumber: true,
      },
    });

    const totalSales = invoices.reduce((sum, inv) => sum + Number(inv.grandTotal), 0);
    const salesperson = await this.prisma.user.findUnique({
      where: { id },
      select: { commissionRate: true, name: true },
    });
    const commissionEarned = totalSales * (Number(salesperson?.commissionRate ?? 0) / 100);

    return {
      totalInvoices: invoices.length,
      totalSales,
      commissionRate: Number(salesperson?.commissionRate ?? 0),
      commissionEarned,
    };
  }

  async getReport(branchId?: string, from?: string, to?: string) {
    const salespersons = await this.prisma.user.findMany({
      where: {
        role: 'SALESPERSON',
        ...(branchId ? { branchId } : {}),
      },
      select: { id: true, name: true, isActive: true },
    });

    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to);

    const results = await Promise.all(
      salespersons.map(async (sp) => {
        const invoices = await this.prisma.invoice.findMany({
          where: {
            salespersonId: sp.id,
            ...(branchId ? { branchId } : {}),
            status: { notIn: ['CANCELLED', 'RETURNED'] },
            ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}),
          },
          select: { grandTotal: true },
        });

        const totalSales = invoices.reduce((sum, inv) => sum + Number(inv.grandTotal), 0);

        return {
          salespersonId: sp.id,
          name: sp.name,
          isActive: sp.isActive,
          invoiceCount: invoices.length,
          totalSales,
        };
      }),
    );

    return results.sort((a, b) => b.totalSales - a.totalSales);
  }
}
