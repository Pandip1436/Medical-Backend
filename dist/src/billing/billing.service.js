"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let BillingService = class BillingService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createInvoiceDto, userId) {
        return this.prisma.$transaction(async (tx) => {
            const invoiceNumber = `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            for (const item of createInvoiceDto.items) {
                const batch = await tx.batch.findUnique({
                    where: { id: item.batchId }
                });
                if (!batch) {
                    throw new common_1.NotFoundException(`Batch ${item.batchNumber} for product ${item.productName} not found`);
                }
                if (batch.quantity < item.quantity) {
                    throw new common_1.BadRequestException(`Insufficient stock for ${item.productName} in batch ${item.batchNumber}. Available: ${batch.quantity}`);
                }
                await tx.batch.update({
                    where: { id: batch.id },
                    data: { quantity: batch.quantity - item.quantity }
                });
                await tx.product.update({
                    where: { id: item.productId },
                    data: { totalStock: { decrement: item.quantity } }
                });
            }
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
    findAll(query) {
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
    async findOne(id) {
        const invoice = await this.prisma.invoice.findUnique({
            where: { id },
            include: { items: true, createdBy: { select: { name: true } } }
        });
        if (!invoice)
            throw new common_1.NotFoundException('Invoice not found');
        return invoice;
    }
};
exports.BillingService = BillingService;
exports.BillingService = BillingService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], BillingService);
//# sourceMappingURL=billing.service.js.map