import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createInvoiceDto: CreateInvoiceDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Generate unique invoice number
      const invoiceNumber = `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // 2. Validate and deduct stock for each item
      for (const item of createInvoiceDto.items) {
        const batch = await tx.batch.findUnique({
          where: { id: item.batchId }
        });

        if (!batch) {
          throw new NotFoundException(`Batch ${item.batchNumber} for product ${item.productName} not found`);
        }

        if (batch.quantity < item.quantity) {
          throw new BadRequestException(`Insufficient stock for ${item.productName} in batch ${item.batchNumber}. Available: ${batch.quantity}`);
        }

        // Deduct from batch
        await tx.batch.update({
          where: { id: batch.id },
          data: { quantity: batch.quantity - item.quantity }
        });

        // Deduct from product total stock
        await tx.product.update({
          where: { id: item.productId },
          data: { totalStock: { decrement: item.quantity } }
        });
      }

      // 3. Create the Invoice and InvoiceItems
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          type: createInvoiceDto.type,
          billingType: createInvoiceDto.billingType,
          customerId: createInvoiceDto.customerId,
          customerName: createInvoiceDto.customerName,
          doctorName: createInvoiceDto.doctorName,
          subtotal: createInvoiceDto.subtotal,
          productDiscount: createInvoiceDto.productDiscount,
          taxableAmount: createInvoiceDto.taxableAmount,
          cgst: createInvoiceDto.cgst,
          sgst: createInvoiceDto.sgst,
          igst: createInvoiceDto.igst || 0,
          roundOff: createInvoiceDto.roundOff,
          grandTotal: createInvoiceDto.grandTotal,
          paymentMode: createInvoiceDto.paymentMode,
          paymentDetails: createInvoiceDto.paymentDetails,
          status: createInvoiceDto.status,
          amountPaid: createInvoiceDto.amountPaid,
          changeReturned: createInvoiceDto.changeReturned,
          createdById: userId,
          items: {
            create: createInvoiceDto.items.map(item => ({
              productId: item.productId,
              productName: item.productName,
              batchId: item.batchId,
              batchNumber: item.batchNumber,
              expiryDate: new Date(item.expiryDate),
              quantity: item.quantity,
              mrp: item.mrp,
              rate: item.rate,
              discountPercent: item.discountPercent,
              gstPercent: item.gstPercent,
              amount: item.amount
            }))
          }
        },
        include: {
          items: true
        }
      });

      // 4. If CREDIT or SPLIT payment and customer exists, update outstanding ledger
      if ((createInvoiceDto.paymentMode === 'CREDIT' || createInvoiceDto.paymentMode === 'SPLIT') && createInvoiceDto.customerId) {
        const amountAddedToCredit = createInvoiceDto.grandTotal - createInvoiceDto.amountPaid;
        
        if (amountAddedToCredit > 0) {
          await tx.customer.update({
            where: { id: createInvoiceDto.customerId },
            data: { currentOutstanding: { increment: amountAddedToCredit } }
          });
        }
      }

      return invoice;
    });
  }

  findAll(query?: string) {
    if (query) {
      return this.prisma.invoice.findMany({
        where: {
          OR: [
            { invoiceNumber: { contains: query, mode: 'insensitive' } },
            { customerName: { contains: query, mode: 'insensitive' } },
          ],
        },
        orderBy: { date: 'desc' },
        take: 50,
      });
    }
    return this.prisma.invoice.findMany({
      orderBy: { date: 'desc' },
      take: 50,
    });
  }

  async findOne(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { items: true, createdBy: { select: { name: true } } }
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }
}
