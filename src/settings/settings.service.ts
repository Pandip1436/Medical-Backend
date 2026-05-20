import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  private async getTargetBranchId(branchId?: string): Promise<string | undefined> {
    if (branchId) return branchId;

    const defaultBranch = await this.prisma.branch.findFirst({
      where: { isDefault: true },
    });

    if (defaultBranch) return defaultBranch.id;

    const firstBranch = await this.prisma.branch.findFirst();
    return firstBranch?.id;
  }

  async getBusinessProfile(branchId?: string) {
    const id = await this.getTargetBranchId(branchId);
    if (!id) return null;

    return this.prisma.branch.findUnique({
      where: { id },
    });
  }

  async updateBusinessProfile(branchId: string, data: any) {
    const id = await this.getTargetBranchId(branchId);
    if (!id) throw new Error('No branch found to update');

    return this.prisma.branch.update({
      where: { id },
      data: {
        name: data.companyName || data.name,
        address: data.address,
        phone: data.phone,
        email: data.email,
        gstin: data.gstin,
        drugLicense: data.drugLicense,
        // @deprecated — use NumberingConfig (POST /numbering/configs/:docType).
        // Kept writable so older clients that still send invoicePrefix don't 400.
        // DocumentNumberingService no longer reads this column.
        invoicePrefix: data.invoicePrefix,
      },
    });
  }

  async getSetting(key: string) {
    const setting = await this.prisma.globalSetting.findUnique({
      where: { key },
    });
    return setting?.value || {};
  }

  async updateSetting(key: string, value: any) {
    return this.prisma.globalSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

}
