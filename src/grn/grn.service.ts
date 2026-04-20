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
        },
        include: { items: true }
      });
      
      // 4. Optionally close the PO if one is linked (Assuming fully received)
      if (createGrnDto.poId) {
         await tx.purchaseOrder.update({
             where: { id: createGrnDto.poId },
             data: { status: 'FULLY_RECEIVED' }
         });
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
    return this.prisma.gRN.findMany({ where, include: { items: true }, orderBy: { date: 'desc' } });
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
