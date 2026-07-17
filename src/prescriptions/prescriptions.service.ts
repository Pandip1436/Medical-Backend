import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { extname } from 'path'
import * as fs from 'fs'
import * as path from 'path'
import { PrismaService } from '../prisma/prisma.service'
import { R2UploadService } from '../common/services/r2-upload.service'

@Injectable()
export class PrescriptionsService {
  private readonly logger = new Logger(PrescriptionsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2UploadService,
  ) {}

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

    // Persist the file to R2 (shared cloud storage) so it's reachable from any
    // environment. Returns an absolute public URL stored as `imageUrl`.
    const key = `prescriptions/${randomUUID()}${extname(file.originalname)}`
    let imageUrl: string
    try {
      imageUrl = await this.r2.upload({
        buffer: file.buffer,
        key,
        contentType: file.mimetype,
      })
    } catch (err) {
      this.logger.error(`Prescription upload to R2 failed: ${(err as Error).message}`)
      throw new BadRequestException('Failed to upload document — please try again')
    }

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

  async findByCustomer(
    customerId: string,
    branchId?: string,
    opts?: { skip?: number; take?: number },
  ) {
    const where: any = { customerId }
    if (branchId) where.branchId = branchId

    const paginated = typeof opts?.skip === 'number' && typeof opts?.take === 'number'
    if (!paginated) {
      return this.prisma.prescription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      })
    }

    const safeTake = Math.min(Math.max(opts!.take!, 1), 100)
    const safeSkip = Math.max(opts!.skip!, 0)
    const [data, total] = await Promise.all([
      this.prisma.prescription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: safeSkip,
        take: safeTake,
      }),
      this.prisma.prescription.count({ where }),
    ])
    return { data, total, hasMore: safeSkip + data.length < total }
  }

  async findOne(id: string, branchId?: string) {
    const p = await this.prisma.prescription.findUnique({ where: { id } })
    if (!p) throw new NotFoundException('Prescription not found')
    if (branchId && p.branchId && p.branchId !== branchId) {
      throw new NotFoundException('Prescription not found')
    }
    return p
  }

  // Edit the metadata (type/doctor, notes, valid-until) of an existing record.
  // The uploaded file itself isn't replaced here — only its details.
  async update(
    id: string,
    data: { doctorName?: string; notes?: string; validUntil?: string },
    branchId?: string,
  ) {
    await this.findOne(id, branchId) // existence + branch-scope guard
    return this.prisma.prescription.update({
      where: { id },
      data: {
        ...(data.doctorName !== undefined ? { doctorName: data.doctorName } : {}),
        ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
        ...(data.validUntil !== undefined
          ? { validUntil: data.validUntil ? new Date(data.validUntil) : null }
          : {}),
      },
    })
  }

  async remove(id: string, branchId?: string) {
    const p = await this.findOne(id, branchId)
    if (p.imageUrl) {
      const key = this.r2.keyFromUrl(p.imageUrl)
      if (key) {
        // R2-hosted file — best-effort delete (orphans can be GC'd later).
        try {
          await this.r2.delete(key)
        } catch (err) {
          this.logger.warn(`Failed to delete R2 object ${key}: ${(err as Error).message}`)
        }
      } else {
        // Legacy record whose file lived on local disk (`/uploads/...`).
        const filePath = path.join(process.cwd(), p.imageUrl)
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      }
    }
    return this.prisma.prescription.delete({ where: { id } })
  }
}
