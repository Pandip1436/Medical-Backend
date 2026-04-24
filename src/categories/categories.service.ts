import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCategoryDto) {
    const existing = await this.prisma.category.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException(`Category "${dto.name}" already exists`);
    return this.prisma.category.create({ data: dto });
  }

  async findAll() {
    const categories = await this.prisma.category.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
    return categories.map((c) => ({ ...c, productCount: c._count.products }));
  }

  async findOne(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!category) throw new NotFoundException('Category not found');
    return { ...category, productCount: category._count.products };
  }

  async update(id: string, dto: UpdateCategoryDto) {
    await this.findOne(id);
    if (dto.name) {
      const existing = await this.prisma.category.findUnique({ where: { name: dto.name } });
      if (existing && existing.id !== id) throw new ConflictException(`Category "${dto.name}" already exists`);
    }
    return this.prisma.category.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    const category = await this.findOne(id);
    if (category.productCount > 0) {
      throw new BadRequestException(`Cannot delete category "${category.name}" — it has ${category.productCount} product(s) assigned`);
    }
    return this.prisma.category.delete({ where: { id } });
  }

  async exportCsv(): Promise<string> {
    const categories = await this.findAll();
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

  async importCsv(buffer: Buffer): Promise<{ created: number; skipped: number; errors: string[] }> {
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
        const existing = await this.prisma.category.findUnique({ where: { name: row['name'] } });
        if (existing) { skipped++; continue; }
        await this.prisma.category.create({
          data: {
            name: row['name'],
            description: row['description'] || undefined,
            color: row['color'] || undefined,
            isActive: row['isactive'] !== 'false',
          },
        });
        created++;
      } catch (err: any) {
        errors.push(`Row ${i + 1} (${row['name']}): ${err.message}`);
      }
    }

    return { created, skipped, errors };
  }
}
