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
exports.SuppliersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let SuppliersService = class SuppliersService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    normalizePhone(phone) {
        if (!phone)
            return '';
        return phone.replace(/\D/g, '');
    }
    async assertNoDuplicate(data, excludeId) {
        const normalizedPhone = this.normalizePhone(data.phone);
        const branchScope = data.branchId
            ? [{ branchId: data.branchId }, { branchId: null }]
            : [{ branchId: null }];
        if (data.gstin) {
            const gstinDup = await this.prisma.supplier.findFirst({
                where: {
                    AND: [
                        { gstin: data.gstin },
                        { OR: branchScope },
                        ...(excludeId ? [{ id: { not: excludeId } }] : []),
                    ],
                },
                select: { id: true, name: true },
            });
            if (gstinDup) {
                throw new common_1.ConflictException(`Another supplier (${gstinDup.name}) already uses GSTIN ${data.gstin} in this branch.`);
            }
        }
        if (normalizedPhone) {
            const last10 = normalizedPhone.slice(-10);
            const candidate = await this.prisma.supplier.findFirst({
                where: {
                    AND: [
                        { phone: { contains: last10 } },
                        { OR: branchScope },
                        ...(excludeId ? [{ id: { not: excludeId } }] : []),
                    ],
                },
                select: { id: true, name: true, phone: true },
            });
            if (candidate && this.normalizePhone(candidate.phone) === normalizedPhone) {
                throw new common_1.ConflictException(`Another supplier (${candidate.name}) already uses this phone in this branch.`);
            }
        }
    }
    async create(createSupplierDto) {
        const dto = {
            ...createSupplierDto,
            phone: this.normalizePhone(createSupplierDto.phone),
        };
        await this.assertNoDuplicate({
            phone: dto.phone,
            gstin: dto.gstin,
            branchId: dto.branchId ?? null,
        });
        return this.prisma.supplier.create({ data: dto });
    }
    async bulkCreate(suppliers, branchId) {
        let createdCount = 0;
        let skippedCount = 0;
        const errors = [];
        const branchScope = branchId ? [{ branchId }, { branchId: null }] : [{ branchId: null }];
        const existingSuppliers = await this.prisma.supplier.findMany({
            where: { OR: branchScope },
            select: { gstin: true, phone: true }
        });
        const existingGstins = new Set(existingSuppliers.map(s => s.gstin).filter(Boolean));
        const existingPhones = new Set(existingSuppliers.map(s => this.normalizePhone(s.phone)).filter(Boolean));
        const toCreate = [];
        for (const [index, s] of suppliers.entries()) {
            try {
                const normalizedPhone = this.normalizePhone(s.phone);
                if (s.gstin && existingGstins.has(s.gstin)) {
                    throw new common_1.ConflictException(`GSTIN ${s.gstin} already exists.`);
                }
                if (normalizedPhone) {
                    const last10 = normalizedPhone.slice(-10);
                    const isDup = Array.from(existingPhones).some(p => p.endsWith(last10));
                    if (isDup) {
                        throw new common_1.ConflictException(`Phone ending in ${last10} already exists.`);
                    }
                }
                if (s.gstin)
                    existingGstins.add(s.gstin);
                if (normalizedPhone)
                    existingPhones.add(normalizedPhone);
                toCreate.push({
                    ...s,
                    phone: normalizedPhone,
                    branchId: branchId ?? null,
                });
            }
            catch (err) {
                skippedCount++;
                errors.push(`Row ${index + 1} (${s.name}): ${err.message}`);
            }
        }
        if (toCreate.length > 0) {
            await this.prisma.supplier.createMany({
                data: toCreate,
                skipDuplicates: true,
            });
            createdCount = toCreate.length;
        }
        return { createdCount, skippedCount, errors };
    }
    findAll(query, branchId) {
        const conditions = [];
        if (branchId && branchId !== 'all') {
            conditions.push({
                OR: [{ branchId }, { branchId: null }],
            });
        }
        if (query) {
            conditions.push({
                OR: [
                    { name: { contains: query, mode: 'insensitive' } },
                    { gstin: { contains: query, mode: 'insensitive' } },
                    { phone: { contains: query } },
                ],
            });
        }
        const where = conditions.length > 0 ? { AND: conditions } : {};
        return this.prisma.supplier.findMany({ where });
    }
    async findOne(id, branchId) {
        const supplier = await this.prisma.supplier.findUnique({
            where: { id },
            include: {
                batches: true,
                purchaseOrders: { take: 10, orderBy: { date: 'desc' } },
            },
        });
        if (!supplier)
            throw new common_1.NotFoundException('Supplier not found');
        if (branchId && supplier.branchId && supplier.branchId !== branchId) {
            throw new common_1.NotFoundException('Supplier not found');
        }
        return supplier;
    }
    async update(id, updateSupplierDto, branchId) {
        const existing = await this.findOne(id, branchId);
        const data = { ...updateSupplierDto };
        if (data.phone !== undefined) {
            data.phone = this.normalizePhone(data.phone);
        }
        if (data.phone !== undefined || data.gstin !== undefined) {
            await this.assertNoDuplicate({
                phone: data.phone,
                gstin: data.gstin,
                branchId: existing.branchId,
            }, id);
        }
        return this.prisma.supplier.update({
            where: { id },
            data,
        });
    }
    async remove(id, branchId) {
        const supplier = await this.findOne(id, branchId);
        const [poCount, grnCount, prCount, batchCount] = await Promise.all([
            this.prisma.purchaseOrder.count({ where: { supplierId: id } }),
            this.prisma.gRN.count({ where: { supplierId: id } }),
            this.prisma.purchaseReturn.count({ where: { supplierId: id } }),
            this.prisma.batch.count({ where: { supplierId: id } }),
        ]);
        const blockers = [];
        if (poCount)
            blockers.push(`${poCount} purchase order(s)`);
        if (grnCount)
            blockers.push(`${grnCount} GRN(s)`);
        if (prCount)
            blockers.push(`${prCount} purchase return(s)`);
        if (batchCount)
            blockers.push(`${batchCount} batch(es)`);
        if (blockers.length > 0) {
            throw new common_1.BadRequestException(`Cannot delete "${supplier.name}" — they're referenced by ${blockers.join(', ')}. Set the supplier inactive instead.`);
        }
        const outstanding = Number(supplier.currentOutstanding ?? 0);
        if (outstanding !== 0) {
            throw new common_1.BadRequestException(`Cannot delete "${supplier.name}" — outstanding balance is ₹${outstanding.toFixed(2)}. Reconcile the ledger first.`);
        }
        return this.prisma.supplier.delete({ where: { id } });
    }
};
exports.SuppliersService = SuppliersService;
exports.SuppliersService = SuppliersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SuppliersService);
//# sourceMappingURL=suppliers.service.js.map