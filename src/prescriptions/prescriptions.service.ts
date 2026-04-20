import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import * as fs from 'fs'
import * as path from 'path'

@Injectable()
export class PrescriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    customerId: string,
    doctorName: string,
    notes: string | undefined,
    validUntil: string | undefined,
    file: Express.Multer.File,
    branchId?: string,
  ) {
    const customer = await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } })
    if (branchId && customer.branchId && customer.branchId !== branchId) {
      throw new NotFoundException('Customer not found')
    }

    const imageUrl = `/uploads/prescriptions/${file.filename}`

    return this.prisma.prescription.create({
      data: {
        customerId,
        branchId: branchId ?? customer.branchId ?? null,
        doctorName,
        notes,
        validUntil: validUntil ? new Date(validUntil) : null,
        imageUrl,
        isActive: true,
      },
    })
  }

  async findByCustomer(customerId: string, branchId?: string) {
    const where: any = { customerId }
    if (branchId) where.branchId = branchId
    return this.prisma.prescription.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOne(id: string, branchId?: string) {
    const p = await this.prisma.prescription.findUnique({ where: { id } })
    if (!p) throw new NotFoundException('Prescription not found')
    if (branchId && p.branchId && p.branchId !== branchId) {
      throw new NotFoundException('Prescription not found')
    }
    return p
  }

  async remove(id: string, branchId?: string) {
    const p = await this.findOne(id, branchId)
    if (p.imageUrl) {
      const filePath = path.join(process.cwd(), p.imageUrl)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    }
    return this.prisma.prescription.delete({ where: { id } })
  }
}
