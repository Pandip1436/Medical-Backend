import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto';

@Injectable()
export class PurchaseReturnsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePurchaseReturnDto, userId: string, userBranchId?: string) {
    return this.prisma.$transaction(async (tx) => {
      // Inherit branchId from the linked GRN if available, fall back to user branch
      let branchId: string | null = userBranchId ?? null;
      if (dto.grnId) {
        const grn = await tx.gRN.findUnique({ where: { id: dto.grnId }, select: { branchId: true } });
        if (grn) {
          if (userBranchId && grn.branchId && grn.branchId !== userBranchId) {
            throw new NotFoundException('GRN not found');
          }
          branchId = grn.branchId ?? userBranchId ?? null;
        }
      }

      for (const item of dto.items) {
        const batch = await tx.batch.findUnique({ where: { id: item.batchId } });
        if (!batch) {
          throw new NotFoundException(`Batch ${item.batchNumber} for ${item.productName} not found`);
        }
        if (batch.quantity < item.returnedQty) {
          throw new BadRequestException(
            `Insufficient stock to return for ${item.productName} batch ${item.batchNumber}. Available: ${batch.quantity}`,
          );
        }
        await tx.batch.update({
          where: { id: batch.id },
          data: { quantity: batch.quantity - item.returnedQty },
        });
        await tx.product.update({
          where: { id: item.productId },
          data: { totalStock: { decrement: item.returnedQty } },
        });
      }

      const debitNoteNo = `DN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      const purchaseReturn = await tx.purchaseReturn.create({
        data: {
          debitNoteNo,
          branchId,
          grnId: dto.grnId,
          supplierId: dto.supplierId,
          supplierName: dto.supplierName,
          reason: dto.reason,
          subtotal: dto.subtotal,
          cgst: dto.cgst ?? 0,
          sgst: dto.sgst ?? 0,
          igst: dto.igst ?? 0,
          totalAmount: dto.totalAmount,
          status: dto.status ?? 'DRAFT',
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
              purchaseRate: it.purchaseRate,
              gstPercent: it.gstPercent,
              amount: it.amount,
            })),
          },
        },
        include: { items: true },
      });

      return purchaseReturn;
    });
  }

  findAll(query?: string, branchId?: string) {
    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (query) {
      where.OR = [
        { debitNoteNo: { contains: query, mode: 'insensitive' } },
        { supplierName: { contains: query, mode: 'insensitive' } },
      ];
    }
    return this.prisma.purchaseReturn.findMany({ 
      where, 
      orderBy: { date: 'desc' }, 
      take: 50,
      include: { items: true, grn: true }
    });
  }

  async findOne(id: string, branchId?: string) {
    const pr = await this.prisma.purchaseReturn.findUnique({
      where: { id },
      include: { items: true, supplier: true, grn: true },
    });
    if (!pr) throw new NotFoundException('Purchase return not found');
    if (branchId && pr.branchId && pr.branchId !== branchId) {
      throw new NotFoundException('Purchase return not found');
    }
    return pr;
  }

  async updateStatus(id: string, status: any, branchId?: string) {
    const pr = await this.prisma.purchaseReturn.findUnique({ where: { id } });
    if (!pr) throw new NotFoundException('Purchase return not found');
    if (branchId && pr.branchId && pr.branchId !== branchId) {
      throw new NotFoundException('Purchase return not found');
    }
    return this.prisma.purchaseReturn.update({
      where: { id },
      data: { status },
    });
  }
}
