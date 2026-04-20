import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';

@Injectable()
export class CreditNotesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCreditNoteDto, userId: string, branchId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: dto.invoiceId },
        include: { items: true, customer: true },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (branchId && invoice.branchId && invoice.branchId !== branchId) {
        throw new NotFoundException('Invoice not found');
      }

      for (const item of dto.items) {
        const invoiceItem = invoice.items.find(
          (i) => i.productId === item.productId && i.batchId === item.batchId,
        );
        if (!invoiceItem) {
          throw new BadRequestException(
            `Item ${item.productName} (batch ${item.batchNumber}) not found on invoice`,
          );
        }
        if (item.returnedQty > invoiceItem.quantity) {
          throw new BadRequestException(
            `Cannot return ${item.returnedQty} of ${item.productName}; only ${invoiceItem.quantity} were sold`,
          );
        }

        await tx.batch.update({
          where: { id: item.batchId },
          data: { quantity: { increment: item.returnedQty } },
        });
        await tx.product.update({
          where: { id: item.productId },
          data: { totalStock: { increment: item.returnedQty } },
        });
      }

      const creditNoteNo = `CN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const settlementMode = dto.settlementMode ?? 'REFUND';

      const creditNote = await tx.creditNote.create({
        data: {
          creditNoteNo,
          branchId: invoice.branchId,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          customerId: invoice.customerId,
          customerName: invoice.customerName,
          reason: dto.reason,
          subtotal: dto.subtotal,
          cgst: dto.cgst ?? 0,
          sgst: dto.sgst ?? 0,
          igst: dto.igst ?? 0,
          totalAmount: dto.totalAmount,
          settlementMode,
          notes: dto.notes,
          createdById: userId,
          items: {
            create: dto.items.map((it) => ({
              productId: it.productId,
              productName: it.productName,
              batchId: it.batchId,
              batchNumber: it.batchNumber,
              expiryDate: new Date(it.expiryDate),
              returnedQty: it.returnedQty,
              rate: it.rate,
              gstPercent: it.gstPercent,
              amount: it.amount,
            })),
          },
        },
        include: { items: true },
      });

      if (settlementMode === 'CREDIT' && invoice.customerId) {
        await tx.customer.update({
          where: { id: invoice.customerId },
          data: { currentOutstanding: { decrement: dto.totalAmount } },
        });
      }

      const totalReturnedSoFar = await tx.creditNote.aggregate({
        where: { invoiceId: invoice.id },
        _sum: { totalAmount: true },
      });
      const returned = Number(totalReturnedSoFar._sum.totalAmount ?? 0);
      if (returned >= Number(invoice.grandTotal)) {
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: 'RETURNED' },
        });
      }

      return creditNote;
    });
  }

  findAll(query?: string, customerId?: string, branchId?: string) {
    const where: any = {};
    if (customerId) where.customerId = customerId;
    if (branchId) where.branchId = branchId;
    if (query) {
      where.OR = [
        { creditNoteNo: { contains: query, mode: 'insensitive' } },
        { invoiceNumber: { contains: query, mode: 'insensitive' } },
        { customerName: { contains: query, mode: 'insensitive' } },
      ];
    }
    return this.prisma.creditNote.findMany({
      where,
      orderBy: { date: 'desc' },
      take: 100,
    });
  }

  async findOne(id: string, branchId?: string) {
    const cn = await this.prisma.creditNote.findUnique({
      where: { id },
      include: { items: true, invoice: true },
    });
    if (!cn) throw new NotFoundException('Credit note not found');
    if (branchId && cn.branchId && cn.branchId !== branchId) {
      throw new NotFoundException('Credit note not found');
    }
    return cn;
  }
}
