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
exports.CategoriesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let CategoriesService = class CategoriesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    branchScope(branchId) {
        if (!branchId)
            return {};
        return { OR: [{ branchId }, { branchId: null }] };
    }
    async assertNameAvailable(name, branchId, ignoreId) {
        const existing = await this.prisma.category.findFirst({
            where: {
                name: { equals: name, mode: 'insensitive' },
                branchId: branchId ?? null,
                ...(ignoreId ? { NOT: { id: ignoreId } } : {}),
            },
        });
        if (existing) {
            throw new common_1.ConflictException(`Category "${name}" already exists in this branch`);
        }
    }
    async create(dto, branchId) {
        await this.assertNameAvailable(dto.name, branchId);
        return this.prisma.category.create({
            data: { ...dto, branchId: branchId ?? null },
        });
    }
    async findAll(branchId) {
        const categories = await this.prisma.category.findMany({
            where: this.branchScope(branchId),
            orderBy: { name: 'asc' },
            include: { _count: { select: { products: true } } },
        });
        return categories.map((c) => ({ ...c, productCount: c._count.products }));
    }
    async findOne(id, branchId) {
        const category = await this.prisma.category.findUnique({
            where: { id },
            include: { _count: { select: { products: true } } },
        });
        if (!category)
            throw new common_1.NotFoundException('Category not found');
        if (branchId && category.branchId && category.branchId !== branchId) {
            throw new common_1.NotFoundException('Category not found');
        }
        return { ...category, productCount: category._count.products };
    }
    async update(id, dto, branchId) {
        const existing = await this.findOne(id, branchId);
        if (dto.name && dto.name !== existing.name) {
            await this.assertNameAvailable(dto.name, existing.branchId ?? undefined, id);
        }
        return this.prisma.category.update({ where: { id }, data: dto });
    }
    async remove(id, branchId) {
        const category = await this.findOne(id, branchId);
        if (category.productCount > 0) {
            throw new common_1.BadRequestException(`Cannot delete category "${category.name}" — it has ${category.productCount} product(s) assigned`);
        }
        return this.prisma.category.delete({ where: { id } });
    }
    async exportCsv(branchId) {
        const categories = await this.findAll(branchId);
        const header = 'name,description,color,isActive,productCount';
        const rows = categories.map((c) => [
            `"${c.name}"`,
            `"${c.description ?? ''}"`,
            `"${c.color ?? ''}"`,
            c.isActive,
            c.productCount,
        ].join(','));
        return [header, ...rows].join('\n');
    }
    async importCsv(buffer, branchId) {
        const text = buffer.toString('utf-8');
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2)
            throw new common_1.BadRequestException('CSV must have a header row and at least one data row');
        const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, '').replace(/"/g, ''));
        if (!headers.includes('name'))
            throw new common_1.BadRequestException('CSV must have a "name" column');
        let created = 0;
        let skipped = 0;
        const errors = [];
        for (let i = 1; i < lines.length; i++) {
            const cells = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
            const row = {};
            headers.forEach((h, idx) => { row[h] = cells[idx] ?? ''; });
            if (!row['name']) {
                errors.push(`Row ${i + 1}: name is required`);
                continue;
            }
            try {
                const existing = await this.prisma.category.findFirst({
                    where: {
                        name: { equals: row['name'], mode: 'insensitive' },
                        branchId: branchId ?? null,
                    },
                });
                if (existing) {
                    skipped++;
                    continue;
                }
                await this.prisma.category.create({
                    data: {
                        name: row['name'],
                        description: row['description'] || undefined,
                        color: row['color'] || undefined,
                        isActive: row['isactive'] !== 'false',
                        branchId: branchId ?? null,
                    },
                });
                created++;
            }
            catch (err) {
                errors.push(`Row ${i + 1} (${row['name']}): ${err.message}`);
            }
        }
        return { created, skipped, errors };
    }
};
exports.CategoriesService = CategoriesService;
exports.CategoriesService = CategoriesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CategoriesService);
//# sourceMappingURL=categories.service.js.map