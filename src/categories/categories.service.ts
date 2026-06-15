import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  // Branch-scoped lookup: a row is "visible" to a branch if it's in that branch
  // OR if its branchId is null (legacy global categories that pre-date the
  // branch column — kept readable for back-compat). New categories should
  // always be created with a branchId.
  private branchScope(branchId?: string) {
    if (!branchId) return {};
    return { OR: [{ branchId }, { branchId: null }] };
  }

  private async assertNameAvailable(name: string, branchId?: string, ignoreId?: string) {
    const existing = await this.prisma.category.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        branchId: branchId ?? null,
        ...(ignoreId ? { NOT: { id: ignoreId } } : {}),
      } as any,
    });
    if (existing) {
      throw new ConflictException(`Category "${name}" already exists in this branch`);
    }
  }

  async create(dto: CreateCategoryDto, branchId?: string) {
    await this.assertNameAvailable(dto.name, branchId);
    return this.prisma.category.create({
      data: { ...dto, branchId: branchId ?? null } as any,
    });
  }

  async findAll(branchId?: string) {
    const categories = await this.prisma.category.findMany({
      where: this.branchScope(branchId) as any,
      orderBy: { name: 'asc' },
      // _count.products is the source of truth for the "With Products" KPI on
      // the Categories page. Scope it to active products so a category whose
      // products have all been archived doesn't keep showing as "in use", and
      // to the current branch so this total agrees with the branch-scoped
      // "Total Products" count on the Products page (a global category can hold
      // products from several branches).
      include: { _count: { select: { products: { where: this.productScope(branchId) } } } },
    });
    return categories.map((c) => ({ ...c, productCount: c._count.products }));
  }

  // Matches the active + branch filter used by the products list so the
  // category product counts line up with the Products page total.
  private productScope(branchId?: string) {
    return { isActive: true, ...(branchId ? { branchId } : {}) };
  }

  async findOne(id: string, branchId?: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      // _count.products is the source of truth for the "With Products" KPI on
      // the Categories page. Scope it to active products (so archived products
      // don't keep a category showing as "in use") and to the current branch
      // so the count agrees with the branch-scoped Products page.
      include: { _count: { select: { products: { where: this.productScope(branchId) } } } },
    });
    if (!category) throw new NotFoundException('Category not found');
    if (branchId && (category as any).branchId && (category as any).branchId !== branchId) {
      throw new NotFoundException('Category not found');
    }
    return { ...category, productCount: category._count.products };
  }

  async update(id: string, dto: UpdateCategoryDto, branchId?: string) {
    const existing = await this.findOne(id, branchId);
    // Only re-check when the name actually changes; scope to the category's
    // own branch so Super Admins (whose req.user.branchId may be null) don't
    // false-positive against an unrelated category in the global scope.
    if (dto.name && dto.name !== existing.name) {
      await this.assertNameAvailable(
        dto.name,
        (existing as any).branchId ?? undefined,
        id,
      );
    }
    return this.prisma.category.update({ where: { id }, data: dto });
  }

  async remove(id: string, branchId?: string) {
    const category = await this.findOne(id, branchId);
    if (category.productCount > 0) {
      throw new BadRequestException(`Cannot delete category "${category.name}" — it has ${category.productCount} product(s) assigned`);
    }
    return this.prisma.category.delete({ where: { id } });
  }

  async exportCsv(branchId?: string): Promise<string> {
    const categories = await this.findAll(branchId);
    const header = 'name,description,color,isActive,productCount';
    const rows = categories.map((c) =>
      [
        `"${c.name}"`,
        `"${c.description ?? ''}"`,
        `"${c.color ?? ''}"`,
        c.isActive,
        c.productCount,
      ].join(',')
    );
    return [header, ...rows].join('\n');
  }

  async importCsv(buffer: Buffer, branchId?: string): Promise<{ created: number; skipped: number; errors: string[] }> {
    const text = buffer.toString('utf-8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new BadRequestException('CSV must have a header row and at least one data row');

    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, '').replace(/"/g, ''));
    if (!headers.includes('name')) throw new BadRequestException('CSV must have a "name" column');

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h] = cells[idx] ?? ''; });

      if (!row['name']) { errors.push(`Row ${i + 1}: name is required`); continue; }

      try {
        const existing = await this.prisma.category.findFirst({
          where: {
            name: { equals: row['name'], mode: 'insensitive' },
            branchId: branchId ?? null,
          } as any,
        });
        if (existing) { skipped++; continue; }
        await this.prisma.category.create({
          data: {
            name: row['name'],
            description: row['description'] || undefined,
            color: row['color'] || undefined,
            isActive: row['isactive'] !== 'false',
            branchId: branchId ?? null,
          } as any,
        });
        created++;
      } catch (err: any) {
        errors.push(`Row ${i + 1} (${row['name']}): ${err.message}`);
      }
    }

    return { created, skipped, errors };
  }
}
