import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SalespersonsService {
  constructor(private prisma: PrismaService) {}

  async findAll(branchId?: string, opts?: { q?: string; take?: number }) {
    // Server-side searchable list — the CRM Leads page uses this for the
    // sales-person filter / column dropdown, where a tenant may have hundreds
    // of salespeople and loading them all in the browser is wasteful. `q`
    // performs a case-insensitive contains on name / email / phone; `take`
    // caps the page size when explicitly provided (other callers still get
    // the full list).
    const q = opts?.q?.trim();
    const take =
      opts?.take !== undefined
        ? Math.min(Math.max(opts.take, 1), 100)
        : undefined;

    return this.prisma.user.findMany({
      where: {
        role: 'SALESPERSON',
        ...(branchId ? { branchId } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' as const } },
                { email: { contains: q, mode: 'insensitive' as const } },
                { phone: { contains: q } },
              ],
            }
          : {}),
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
      ...(take !== undefined ? { take } : {}),
    });
  }

  async getStats(id: string, branchId?: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        salespersonId: id,
        type: 'INVOICE',
        ...(branchId ? { branchId } : {}),
        // Canonical "real sales" filter, consistent with billing summary,
        // customer totals, ledger and P&L: exclude DRAFT (unposted) and
        // CANCELLED (voided). RETURNED stays in gross sales.
        status: { notIn: ['DRAFT', 'CANCELLED'] },
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
    if (to) {
      // Make the `to` boundary inclusive of the entire day, consistent with
      // the billing summary endpoint — otherwise invoices created later in the
      // day are silently excluded because `new Date('YYYY-MM-DD')` resolves to
      // midnight UTC.
      const toEnd = new Date(to);
      toEnd.setHours(23, 59, 59, 999);
      dateFilter.lte = toEnd;
    }

    const results = await Promise.all(
      salespersons.map(async (sp) => {
        const invoices = await this.prisma.invoice.findMany({
          where: {
            salespersonId: sp.id,
            type: 'INVOICE',
            ...(branchId ? { branchId } : {}),
            // Same canonical filter as everywhere else — exclude DRAFT +
            // CANCELLED so this report agrees with the salesperson detail page.
            status: { notIn: ['DRAFT', 'CANCELLED'] },
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
