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

    // Trim the incoming name so a stray leading/trailing space in the
    // Settings → Business Profile form doesn't end up persisted as the
    // branch name (then leaking into /api/auth/me responses). See BUGS.md SEV-4.
    const rawName = data.companyName || data.name;
    return this.prisma.branch.update({
      where: { id },
      data: {
        name: typeof rawName === 'string' ? rawName.trim() : rawName,
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

  // Master switch for the whole inventory side of the app (Settings → General →
  // Inventory → "Stock Tracking", admin-only). ON is the historical behaviour:
  // a sale must resolve a batch with enough stock, and it decrements that batch.
  //
  // OFF puts the app in "infinite stock" mode for operators who never record
  // purchases at all — they only ever sell. In that mode billing performs NO
  // stock validation and NO stock mutation: batches and totalStock are frozen
  // exactly where they were, so the numbers stay meaningful if tracking is ever
  // switched back ON (rather than spiralling into a large meaningless negative).
  //
  // Deliberately defaults to TRUE when the key is missing or the field is
  // absent — a fresh install, or one that predates this setting, keeps the
  // stock checks. Only an explicit `false` disables them.
  async isStockTrackingEnabled(): Promise<boolean> {
    const general = (await this.getSetting('general_settings')) as {
      stockTracking?: unknown;
    };
    return general?.stockTracking !== false;
  }
}
