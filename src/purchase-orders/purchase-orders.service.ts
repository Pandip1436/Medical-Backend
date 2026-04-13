import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';

@Injectable()
export class PurchaseOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createPurchaseOrderDto: CreatePurchaseOrderDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const poNumber = `PO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      return tx.purchaseOrder.create({
        data: {
          poNumber,
          supplierId: createPurchaseOrderDto.supplierId,
          supplierName: createPurchaseOrderDto.supplierName,
          totalAmount: createPurchaseOrderDto.totalAmount,
          status: createPurchaseOrderDto.status,
          expectedDelivery: createPurchaseOrderDto.expectedDelivery ? new Date(createPurchaseOrderDto.expectedDelivery) : null,
          createdBy: userId,
          items: {
            create: createPurchaseOrderDto.items.map(item => ({
              productId: item.productId,
              productName: item.productName,
              requiredQty: item.requiredQty,
              lastPurchaseRate: item.lastPurchaseRate,
              expectedRate: item.expectedRate,
              remarks: item.remarks
            }))
          }
        },
        include: { items: true }
      });
    });
  }

  findAll(query?: string) {
    if (query) {
      return this.prisma.purchaseOrder.findMany({
        where: {
          OR: [
            { poNumber: { contains: query, mode: 'insensitive' } },
            { supplierName: { contains: query, mode: 'insensitive' } },
          ],
        },
        orderBy: { date: 'desc' },
      });
    }
    return this.prisma.purchaseOrder.findMany({ orderBy: { date: 'desc' } });
  }

  async findOne(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { items: true }
    });
    if (!po) throw new NotFoundException('Purchase Order not found');
    return po;
  }

  async update(id: string, updatePurchaseOrderDto: UpdatePurchaseOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      const existingPo = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
      if (!existingPo) throw new NotFoundException('Purchase order not found');
      
      if (updatePurchaseOrderDto.items) {
        // Delete existing items and recreate
        await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
      }

      return tx.purchaseOrder.update({
        where: { id },
        data: {
          supplierId: updatePurchaseOrderDto.supplierId,
          supplierName: updatePurchaseOrderDto.supplierName,
          totalAmount: updatePurchaseOrderDto.totalAmount,
          status: updatePurchaseOrderDto.status,
          expectedDelivery: updatePurchaseOrderDto.expectedDelivery ? new Date(updatePurchaseOrderDto.expectedDelivery) : undefined,
          ...(updatePurchaseOrderDto.items && {
            items: {
              create: updatePurchaseOrderDto.items.map(item => ({
                productId: item.productId,
                productName: item.productName,
                requiredQty: item.requiredQty,
                lastPurchaseRate: item.lastPurchaseRate,
                expectedRate: item.expectedRate,
                remarks: item.remarks
              }))
            }
          })
        },
        include: { items: true }
      });
    });
  }

  async remove(id: string) {
    // Only allow deletion if draft or maybe just generic delete. Usually Drafts can be deleted.
    return this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
      return tx.purchaseOrder.delete({ where: { id } });
    });
  }
}
