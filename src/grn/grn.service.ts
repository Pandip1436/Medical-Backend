import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGrnDto } from './dto/create-grn.dto';

@Injectable()
export class GrnService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createGrnDto: CreateGrnDto, branchId?: string) {
    const effectiveBranchId = branchId ?? createGrnDto.branchId;
    return this.prisma.$transaction(async (tx) => {
      // 1. Generate unique GRN number
      const grnNumber = `GRN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // 2. Loop through GRN items and process Stock and Batches
      for (const item of createGrnDto.items) {
        // Calculate the valid stock addition (We do NOT subtract damageQty here, because damaged goods must formally pass through Purchase Returns to generate a Debit Note)
        const addedStock = item.receivedQty + item.freeQty;
        
        if (addedStock > 0) {
          // A. Create a new Batch mapped to this GRN and Product
          await tx.batch.create({
            data: {
              productId: item.productId,
              batchNumber: item.batchNumber,
              mfgDate: new Date(item.mfgDate),
              expiryDate: new Date(item.expiryDate),
              quantity: addedStock,
              mrp: item.mrp,
              purchaseRate: item.purchaseRate,
              supplierId: createGrnDto.supplierId,
            }
          });

          // B. Update master Product totalStock, and maybe update lastPurchaseRate
          await tx.product.update({
            where: { id: item.productId },
            data: { 
              totalStock: { increment: addedStock },
              purchaseRate: item.purchaseRate, // Update to latest purchase rate
              mrp: item.mrp // Update to latest MRP
            }
          });
        }
      }

      // 3. Create the GRN Header record
      const isReplacement = (createGrnDto as any).isReplacement === true;
      const grn = await tx.gRN.create({
        data: {
          grnNumber,
          poId: createGrnDto.poId,
          supplierId: createGrnDto.supplierId,
          supplierName: createGrnDto.supplierName,
          supplierInvoiceNo: createGrnDto.supplierInvoiceNo,
          supplierInvoiceDate: new Date(createGrnDto.supplierInvoiceDate),
          supplierInvoiceAmount: createGrnDto.supplierInvoiceAmount,
          totalAmount: createGrnDto.totalAmount,
          status: createGrnDto.status,
          branchId: effectiveBranchId,
          isReplacement,
          items: {
            create: createGrnDto.items.map(item => ({
              productId: item.productId,
              productName: item.productName,
              orderedQty: item.orderedQty,
              receivedQty: item.receivedQty,
              freeQty: item.freeQty,
              batchNumber: item.batchNumber,
              mfgDate: new Date(item.mfgDate),
              expiryDate: new Date(item.expiryDate),
              purchaseRate: item.purchaseRate,
              mrp: item.mrp,
              damageQty: item.damageQty
            }))
          }
        } as any,
        include: { items: true }
      });

      // 3.5 Increment supplier outstanding (we owe them for received goods on credit)
      // Skip for replacement GRNs — those are stock-back, not new payables
      if (!isReplacement && createGrnDto.supplierInvoiceAmount > 0) {
        await tx.supplier.update({
          where: { id: createGrnDto.supplierId },
          data: { currentOutstanding: { increment: createGrnDto.supplierInvoiceAmount } as any },
        });
      }
      
      // 4. Update PO status and PurchaseOrderItem.receivedQty
      if (createGrnDto.poId) {
        const po = await tx.purchaseOrder.findUnique({
          where: { id: createGrnDto.poId },
          include: { items: true },
        });
        if (po) {
          // Sum all received qty across ALL grns linked to this PO per product
          const allGrns = await tx.gRN.findMany({
            where: { poId: createGrnDto.poId },
            include: { items: true },
          });
          const receivedByProduct: Record<string, number> = {};
          for (const g of allGrns) {
            for (const gi of g.items) {
              receivedByProduct[gi.productId] = (receivedByProduct[gi.productId] ?? 0) + gi.receivedQty + gi.freeQty;
            }
          }
          // Update each PO item's receivedQty
          for (const pi of po.items) {
            const totalReceived = receivedByProduct[pi.productId] ?? 0;
            if (totalReceived !== pi.receivedQty) {
              await tx.purchaseOrderItem.update({
                where: { id: pi.id },
                data: { receivedQty: totalReceived },
              });
            }
          }
          const allFulfilled = po.items.every(
            (pi) => (receivedByProduct[pi.productId] ?? 0) >= pi.requiredQty
          );
          await tx.purchaseOrder.update({
            where: { id: createGrnDto.poId },
            data: { status: allFulfilled ? 'FULLY_RECEIVED' : 'PARTIALLY_RECEIVED' },
          });
        }
      }

      return grn;
    });
  }

  findAll(query?: string, branchId?: string) {
    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (query) {
      where.OR = [
        { grnNumber: { contains: query, mode: 'insensitive' } },
        { supplierName: { contains: query, mode: 'insensitive' } },
        { supplierInvoiceNo: { contains: query, mode: 'insensitive' } },
      ];
    }
    return this.prisma.gRN.findMany({
      where,
      include: { items: true, purchaseReturns: { include: { items: true } } },
      orderBy: { date: 'desc' },
    });
  }

  async reverseShortDeliveryStockDeduction() {
    // Find all PurchaseReturns where reason indicates short delivery (no physical goods).
    // Add the wrongly-deducted qty back to batch.quantity and product.totalStock.
    const allReturns = await this.prisma.purchaseReturn.findMany({
      include: { items: true },
    });
    const shortReturns = allReturns.filter((pr) =>
      /short.*delivery|short.*supply/i.test(pr.reason ?? ''),
    );

    let batchesFixed = 0;
    let productsFixed = 0;
    const fixed: Array<{ debitNoteNo: string; reason: string; items: number }> = [];

    for (const pr of shortReturns) {
      for (const item of pr.items) {
        // Re-add to batch
        const batch = await this.prisma.batch.findUnique({ where: { id: item.batchId } });
        if (batch) {
          await this.prisma.batch.update({
            where: { id: item.batchId },
            data: { quantity: { increment: item.returnedQty } },
          });
          batchesFixed++;
        }
        // Re-add to product totalStock
        await this.prisma.product.update({
          where: { id: item.productId },
          data: { totalStock: { increment: item.returnedQty } },
        }).catch(() => {});
        productsFixed++;
      }
      fixed.push({ debitNoteNo: pr.debitNoteNo, reason: pr.reason, items: pr.items.length });
    }

    return {
      message: `Reversed stock deduction for ${shortReturns.length} short-delivery debit note(s). ${batchesFixed} batch updates, ${productsFixed} product stock updates.`,
      fixed,
    };
  }

  async backfillPoStatusWithDebitNotes() {
    // Recompute every PO's status considering both GRN deliveries AND short-delivery debit notes
    const pos = await this.prisma.purchaseOrder.findMany({ include: { items: true } });
    let updated = 0;
    for (const po of pos) {
      const allGrns = await this.prisma.gRN.findMany({
        where: { poId: po.id },
        include: { items: true, purchaseReturns: { include: { items: true } } },
      });
      if (allGrns.length === 0) continue;

      const receivedByProduct: Record<string, number> = {};
      const debitedByProduct: Record<string, number> = {};
      for (const g of allGrns) {
        for (const gi of g.items) {
          receivedByProduct[gi.productId] = (receivedByProduct[gi.productId] ?? 0) + gi.receivedQty + gi.freeQty;
        }
        for (const pr of g.purchaseReturns ?? []) {
          if (/short|excess/i.test(pr.reason ?? '')) {
            for (const pi of pr.items) {
              debitedByProduct[pi.productId] = (debitedByProduct[pi.productId] ?? 0) + pi.returnedQty;
            }
          }
        }
      }
      const allFulfilled = po.items.every(
        (pi) => ((receivedByProduct[pi.productId] ?? 0) + (debitedByProduct[pi.productId] ?? 0)) >= pi.requiredQty
      );
      const expected = allFulfilled ? 'FULLY_RECEIVED' : 'PARTIALLY_RECEIVED';
      if (po.status !== expected && po.status !== 'CLOSED' && po.status !== 'DRAFT') {
        await this.prisma.purchaseOrder.update({
          where: { id: po.id },
          data: { status: expected },
        });
        updated++;
      }
    }
    return { message: `PO status backfill (with debit notes) complete. ${updated} POs updated.` };
  }

  async backfillSupplierOutstanding() {
    // Recompute each supplier's outstanding from scratch:
    // outstanding = sum(GRN.supplierInvoiceAmount where !isReplacement) - sum(PurchaseReturn.totalAmount where settlementMode = 'ADJUST')
    const suppliers = await this.prisma.supplier.findMany();
    let updated = 0;
    for (const s of suppliers) {
      const grns = await this.prisma.gRN.findMany({
        where: { supplierId: s.id },
      });
      const grnSum = grns.reduce((acc, g) => acc + ((g as any).isReplacement ? 0 : Number(g.supplierInvoiceAmount)), 0);
      const adjustReturns = await this.prisma.purchaseReturn.findMany({
        where: { supplierId: s.id, settlementMode: 'ADJUST' as any },
      });
      const adjustSum = adjustReturns.reduce((acc, r) => acc + Number(r.totalAmount), 0);
      const expected = Math.max(0, grnSum - adjustSum);
      if (Number(s.currentOutstanding) !== expected) {
        await this.prisma.supplier.update({
          where: { id: s.id },
          data: { currentOutstanding: expected as any },
        });
        updated++;
      }
    }
    return { message: `Supplier outstanding backfill complete. ${updated} suppliers updated.` };
  }

  async backfillGrnOrderedQty() {
    // For each PO, walk through GRNs in chronological order and set
    // each GRN item's orderedQty = remaining qty at the time of that delivery
    const pos = await this.prisma.purchaseOrder.findMany({
      include: { items: true },
    });
    let updated = 0;
    for (const po of pos) {
      const grns = await this.prisma.gRN.findMany({
        where: { poId: po.id },
        include: { items: true },
        orderBy: { date: 'asc' },
      });
      if (grns.length === 0) continue;

      // Track running received qty per product
      const cumulativeReceived: Record<string, number> = {};
      const requiredByProduct: Record<string, number> = {};
      for (const pi of po.items) {
        requiredByProduct[pi.productId] = pi.requiredQty;
      }

      for (const grn of grns) {
        for (const gi of grn.items) {
          const required = requiredByProduct[gi.productId] ?? gi.orderedQty;
          const alreadyReceived = cumulativeReceived[gi.productId] ?? 0;
          const expectedThisDelivery = Math.max(0, required - alreadyReceived);
          if (expectedThisDelivery !== gi.orderedQty) {
            await this.prisma.gRNItem.update({
              where: { id: gi.id },
              data: { orderedQty: expectedThisDelivery },
            });
            updated++;
          }
          cumulativeReceived[gi.productId] = alreadyReceived + gi.receivedQty + gi.freeQty;
        }
      }
    }
    return { message: `Backfill complete. ${updated} GRN items updated.` };
  }

  async backfillPoReceivedQty() {
    // Find all POs that have linked GRNs
    const pos = await this.prisma.purchaseOrder.findMany({
      include: { items: true },
    });
    let updated = 0;
    for (const po of pos) {
      const allGrns = await this.prisma.gRN.findMany({
        where: { poId: po.id },
        include: { items: true },
      });
      if (allGrns.length === 0) continue;
      const receivedByProduct: Record<string, number> = {};
      for (const g of allGrns) {
        for (const gi of g.items) {
          receivedByProduct[gi.productId] = (receivedByProduct[gi.productId] ?? 0) + gi.receivedQty + gi.freeQty;
        }
      }
      for (const pi of po.items) {
        const totalReceived = receivedByProduct[pi.productId] ?? 0;
        if (totalReceived !== pi.receivedQty) {
          await this.prisma.purchaseOrderItem.update({
            where: { id: pi.id },
            data: { receivedQty: totalReceived },
          });
          updated++;
        }
      }
      const allFulfilled = po.items.every(
        (pi) => (receivedByProduct[pi.productId] ?? 0) >= pi.requiredQty
      );
      const expectedStatus = allFulfilled ? 'FULLY_RECEIVED' : 'PARTIALLY_RECEIVED';
      if (po.status !== expectedStatus && po.status !== 'CLOSED' && po.status !== 'DRAFT') {
        await this.prisma.purchaseOrder.update({
          where: { id: po.id },
          data: { status: expectedStatus },
        });
      }
    }
    return { message: `Backfill complete. ${updated} PO items updated.` };
  }

  async findOne(id: string, branchId?: string) {
    const grn = await this.prisma.gRN.findUnique({
      where: { id },
      include: { items: true }
    });
    if (!grn) throw new NotFoundException('GRN not found');
    if (branchId && grn.branchId && grn.branchId !== branchId) {
      throw new NotFoundException('GRN not found');
    }
    return grn;
  }
}
