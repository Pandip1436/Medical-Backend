import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';

@Injectable()
export class CreditNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalsService: ApprovalsService,
    private readonly numbering: DocumentNumberingService,
  ) {}

  async create(dto: CreateCreditNoteDto, userId: string, branchId?: string, userRole?: string) {
    // PHARMACIST must request approval; action executes only after admin approves
    if (userRole === 'PHARMACIST') {
      const invoice = await this.prisma.invoice.findUnique({ where: { id: dto.invoiceId } });
      if (!invoice) throw new NotFoundException('Invoice not found');
      const req = await this.approvalsService.createRequest({
        type: 'SALES_RETURN',
        payload: {
          ...dto,
          invoiceNumber: invoice.invoiceNumber,
          customerId: invoice.customerId,
          customerName: invoice.customerName,
          createdById: userId,
        },
        requestedById: userId,
        branchId: branchId ?? invoice.branchId ?? undefined,
      });
      return { approvalRequested: true, approvalRequestId: req.id };
    }

    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: dto.invoiceId },
        include: { items: true, customer: true },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (branchId && invoice.branchId && invoice.branchId !== branchId) {
        throw new NotFoundException('Invoice not found');
      }

      // Sum returned qty from prior credit notes against this invoice so we
      // can cap each line at (sold - alreadyReturned). Without this, two
      // sequential credit notes can over-restore stock and over-credit
      // the customer.
      const priorReturns = await tx.creditNoteItem.findMany({
        where: { creditNote: { invoiceId: invoice.id } },
        select: { productId: true, batchId: true, returnedQty: true },
      });
      const priorByKey = new Map<string, number>();
      for (const r of priorReturns) {
        const k = `${r.productId}::${r.batchId}`;
        priorByKey.set(k, (priorByKey.get(k) ?? 0) + r.returnedQty);
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
        const alreadyReturned =
          priorByKey.get(`${item.productId}::${item.batchId}`) ?? 0;
        const remaining = invoiceItem.quantity - alreadyReturned;
        if (item.returnedQty > remaining) {
          throw new BadRequestException(
            `Cannot return ${item.returnedQty} of ${item.productName}: only ${remaining} unreturned (sold ${invoiceItem.quantity}, already returned ${alreadyReturned})`,
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

      const creditNoteNo = await this.numbering.nextNumber(
        tx,
        'CN',
        invoice.branchId ?? branchId ?? null,
      );
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
          // CREDIT mode auto-decrements outstanding immediately, so the note
          // is settled at create time. REFUND/REPLACEMENT remain pending
          // (settledAt = null) until the cash refund is recorded or the
          // replacement invoice is issued.
          settledAt: settlementMode === 'CREDIT' ? new Date() : null,
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
