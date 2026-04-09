import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createProductDto: CreateProductDto) {
    if (createProductDto.barcode) {
      const existing = await this.prisma.product.findUnique({
        where: { barcode: createProductDto.barcode }
      });
      if (existing) throw new ConflictException('Product with this barcode already exists');
    }
    
    return this.prisma.product.create({
      data: createProductDto,
    });
  }

  async findAll(query?: string) {
    if (query) {
      return this.prisma.product.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { genericName: { contains: query, mode: 'insensitive' } },
            { barcode: { contains: query, mode: 'insensitive' } },
          ],
        },
        include: { batches: true }
      });
    }
    return this.prisma.product.findMany({
      include: { batches: true }
    });
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { batches: true, alternatives: true }
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async update(id: string, updateProductDto: UpdateProductDto) {
    // Check if product exists
    await this.findOne(id);
    
    // Check barcode clash if sending new barcode
    if (updateProductDto.barcode) {
      const existing = await this.prisma.product.findUnique({
        where: { barcode: updateProductDto.barcode }
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('Barcode is already assigned to a different product');
      }
    }

    return this.prisma.product.update({
      where: { id },
      data: updateProductDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.product.delete({
      where: { id },
    });
  }
}
