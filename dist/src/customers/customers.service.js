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
exports.CustomersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const approvals_service_1 = require("../approvals/approvals.service");
let CustomersService = class CustomersService {
    prisma;
    approvalsService;
    constructor(prisma, approvalsService) {
        this.prisma = prisma;
        this.approvalsService = approvalsService;
    }
    normalizePhone(phone) {
        if (!phone)
            return '';
        return phone.replace(/\D/g, '');
    }
    async assertUniquePhone(phone, branchId, excludeId) {
        const normalized = this.normalizePhone(phone);
        if (!normalized)
            return;
        const branchScope = branchId
            ? [{ branchId }, { branchId: null }]
            : [{ branchId: null }];
        const last10 = normalized.slice(-10);
        const candidates = await this.prisma.customer.findFirst({
            where: {
                AND: [
                    { phone: { contains: last10 } },
                    { OR: branchScope },
                    ...(excludeId ? [{ id: { not: excludeId } }] : []),
                ],
            },
            select: { id: true, name: true, phone: true },
        });
        if (candidates && this.normalizePhone(candidates.phone) === normalized) {
            throw new common_1.ConflictException(`Phone ${phone} is already used by customer "${candidates.name}". Search and edit that record instead of creating a duplicate.`);
        }
    }
    async create(createCustomerDto, user) {
        const normalizedPhone = this.normalizePhone(createCustomerDto.phone);
        const dto = { ...createCustomerDto, phone: normalizedPhone };
        await this.assertUniquePhone(dto.phone, dto.branchId ?? null);
        if (user?.role === 'PHARMACIST') {
            const { branchId, ...payload } = dto;
            const req = await this.approvalsService.createRequest({
                type: 'NEW_CUSTOMER',
                payload: payload,
                requestedById: user.userId,
                branchId,
            });
            return { approvalRequested: true, approvalRequestId: req.id };
        }
        return this.prisma.customer.create({ data: dto });
    }
    async bulkCreate(customers, branchId) {
        let createdCount = 0;
        let skippedCount = 0;
        const errors = [];
        const branchScope = branchId ? [{ branchId }, { branchId: null }] : [{ branchId: null }];
        const existingCustomers = await this.prisma.customer.findMany({
            where: { OR: branchScope },
            select: { phone: true }
        });
        const existingPhones = new Set(existingCustomers.map(c => this.normalizePhone(c.phone)).filter(Boolean));
        const toCreate = [];
        for (const [index, c] of customers.entries()) {
            try {
                const normalizedPhone = this.normalizePhone(c.phone);
                if (normalizedPhone) {
                    const last10 = normalizedPhone.slice(-10);
                    const isDup = Array.from(existingPhones).some(p => p.endsWith(last10));
                    if (isDup) {
                        throw new common_1.ConflictException(`Phone ending in ${last10} already exists.`);
                    }
                }
                if (normalizedPhone)
                    existingPhones.add(normalizedPhone);
                toCreate.push({
                    ...c,
                    phone: normalizedPhone,
                    branchId: branchId ?? null,
                });
            }
            catch (err) {
                skippedCount++;
                errors.push(`Row ${index + 1} (${c.name}): ${err.message}`);
            }
        }
        if (toCreate.length > 0) {
            await this.prisma.customer.createMany({
                data: toCreate,
                skipDuplicates: true,
            });
            createdCount = toCreate.length;
        }
        return { createdCount, skippedCount, errors };
    }
    async findAll(query, branchId) {
        const where = {};
        if (branchId)
            where.branchId = branchId;
        if (query) {
            where.OR = [
                { name: { contains: query, mode: 'insensitive' } },
                { phone: { contains: query } },
            ];
        }
        const customers = await this.prisma.customer.findMany({
            where,
            include: {
                _count: {
                    select: {
                        invoices: { where: { status: { in: ['CREDIT', 'PARTIAL'] } } },
                    },
                },
            },
        });
        return customers.map(({ _count, ...c }) => ({
            ...c,
            pendingCreditCount: _count.invoices,
        }));
    }
    async findOne(id, branchId) {
        const customer = await this.prisma.customer.findUnique({
            where: { id },
            include: {
                prescriptions: true,
                invoices: { take: 10, orderBy: { date: 'desc' } },
            },
        });
        if (!customer)
            throw new common_1.NotFoundException('Customer not found');
        if (branchId && customer.branchId && customer.branchId !== branchId) {
            throw new common_1.NotFoundException('Customer not found');
        }
        return customer;
    }
    async update(id, updateCustomerDto, branchId) {
        const existing = await this.findOne(id, branchId);
        const data = { ...updateCustomerDto };
        if (data.phone !== undefined) {
            const normalized = this.normalizePhone(data.phone);
            if (normalized !== this.normalizePhone(existing.phone)) {
                await this.assertUniquePhone(normalized, existing.branchId ?? null, id);
            }
            data.phone = normalized;
        }
        return this.prisma.customer.update({ where: { id }, data });
    }
    async remove(id, branchId) {
        const customer = await this.findOne(id, branchId);
        const openInvoiceCount = await this.prisma.invoice.count({
            where: {
                customerId: id,
                status: { notIn: ['PAID', 'RETURNED', 'CANCELLED'] },
            },
        });
        if (openInvoiceCount > 0) {
            throw new common_1.BadRequestException(`Cannot delete "${customer.name}" — they have ${openInvoiceCount} open invoice(s). Settle or cancel those first, or set the customer inactive instead.`);
        }
        const outstanding = Number(customer.currentOutstanding ?? 0);
        if (outstanding > 0) {
            throw new common_1.BadRequestException(`Cannot delete "${customer.name}" — outstanding balance is ₹${outstanding.toFixed(2)}. Reconcile the ledger first.`);
        }
        return this.prisma.customer.delete({ where: { id } });
    }
    async getOutstanding(branchId) {
        const invoices = await this.prisma.invoice.findMany({
            where: {
                status: { in: ['CREDIT', 'PARTIAL'] },
                ...(branchId ? { branchId } : {}),
            },
            select: {
                id: true,
                invoiceNumber: true,
                customerId: true,
                customerName: true,
                grandTotal: true,
                amountPaid: true,
                date: true,
                branchId: true,
            },
            orderBy: { date: 'asc' },
        });
        const map = new Map();
        for (const inv of invoices) {
            if (!inv.customerId)
                continue;
            const key = inv.customerId;
            const due = Number(inv.grandTotal) - Number(inv.amountPaid);
            if (due <= 0)
                continue;
            if (!map.has(key)) {
                map.set(key, { customerId: inv.customerId, customerName: inv.customerName, outstanding: 0, invoices: [] });
            }
            const entry = map.get(key);
            entry.outstanding += due;
            entry.invoices.push(inv);
        }
        const now = Date.now();
        const rows = Array.from(map.values()).map((entry) => {
            let current = 0, d0_30 = 0, d31_60 = 0, d61_90 = 0, d90plus = 0;
            for (const inv of entry.invoices) {
                const due = Number(inv.grandTotal) - Number(inv.amountPaid);
                const ageDays = Math.floor((now - new Date(inv.date).getTime()) / 86400000);
                if (ageDays <= 0)
                    current += due;
                else if (ageDays <= 30)
                    d0_30 += due;
                else if (ageDays <= 60)
                    d31_60 += due;
                else if (ageDays <= 90)
                    d61_90 += due;
                else
                    d90plus += due;
            }
            return {
                customerId: entry.customerId,
                customer: entry.customerName,
                outstanding: entry.outstanding,
                current,
                '0-30': d0_30,
                '31-60': d31_60,
                '61-90': d61_90,
                '90+': d90plus,
                invoiceCount: entry.invoices.length,
            };
        });
        rows.sort((a, b) => b.outstanding - a.outstanding);
        return {
            total: rows.reduce((s, r) => s + r.outstanding, 0),
            rows,
        };
    }
    async recordPayment(id, amount, paymentMode, referenceNumber, branchId) {
        if (amount <= 0)
            throw new common_1.BadRequestException('Amount must be greater than zero');
        const customer = await this.findOne(id, branchId);
        const openInvoices = await this.prisma.invoice.findMany({
            where: {
                customerId: id,
                status: { in: ['CREDIT', 'PARTIAL'] },
            },
            orderBy: { date: 'asc' },
        });
        if (openInvoices.length === 0) {
            throw new common_1.BadRequestException('No outstanding invoices for this customer');
        }
        const totalOutstanding = openInvoices.reduce((s, inv) => s + Number(inv.grandTotal) - Number(inv.amountPaid), 0);
        if (amount > totalOutstanding + 0.01) {
            throw new common_1.BadRequestException(`Payment amount (₹${amount.toFixed(2)}) exceeds outstanding balance (₹${totalOutstanding.toFixed(2)})`);
        }
        const receiptNumber = `RCT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        return this.prisma.$transaction(async (tx) => {
            let remaining = amount;
            const allocations = [];
            for (const inv of openInvoices) {
                if (remaining <= 0.01)
                    break;
                const due = Number(inv.grandTotal) - Number(inv.amountPaid);
                const applied = Math.min(remaining, due);
                const newAmountPaid = Number(inv.amountPaid) + applied;
                const stillDue = Number(inv.grandTotal) - newAmountPaid;
                const newStatus = stillDue <= 0.01 ? 'PAID' : 'PARTIAL';
                await tx.invoice.update({
                    where: { id: inv.id },
                    data: { amountPaid: newAmountPaid, status: newStatus },
                });
                allocations.push({ invoiceId: inv.id, applied, newStatus });
                remaining -= applied;
            }
            const totalApplied = amount - Math.max(0, remaining);
            await tx.customer.update({
                where: { id },
                data: { currentOutstanding: { decrement: totalApplied } },
            });
            const payment = await tx.payment.create({
                data: {
                    receiptNumber,
                    customerId: id,
                    invoiceId: allocations.length === 1 ? allocations[0].invoiceId : null,
                    amount: totalApplied,
                    paymentMode,
                    referenceNumber: referenceNumber ?? null,
                    branchId: customer.branchId ?? branchId ?? null,
                },
            });
            return {
                receiptNumber: payment.receiptNumber,
                customerId: id,
                amountRecorded: totalApplied,
                allocations,
                newOutstanding: Math.max(0, Number(customer.currentOutstanding) - totalApplied),
            };
        });
    }
    async getPaymentHistory(id, branchId) {
        await this.findOne(id, branchId);
        return this.prisma.payment.findMany({
            where: { customerId: id },
            orderBy: { createdAt: 'desc' },
            take: 50,
        });
    }
};
exports.CustomersService = CustomersService;
exports.CustomersService = CustomersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        approvals_service_1.ApprovalsService])
], CustomersService);
//# sourceMappingURL=customers.service.js.map