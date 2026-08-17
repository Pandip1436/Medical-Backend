import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Runtime on/off switches for each automated WhatsApp message, stored in the
// DB so an admin can toggle them from Settings instead of needing a redeploy.
// That matters on Cloud Run, where changing an env var means shipping a new
// revision — if a supplier complains about low-stock alerts, the client needs
// to stop them in seconds, not at the next deploy.
export type WhatsAppAutomation =
  | 'invoiceAutoSend'    // invoice + payment QR on a credit/partial sale
  | 'paymentReceipt'     // receipt when a payment is recorded
  | 'saleReminder'       // monthly customer reminder
  | 'lowStock'           // low-stock alert to the supplier
  | 'orderDispatched';   // dispatch notice to the hospital

export const WHATSAPP_AUTOMATION_KEY = 'whatsapp-automation';

// Each flag falls back to its original env var when the DB has no explicit
// value. This is what makes the migration safe: on first deploy nothing has
// been saved yet, so behaviour is exactly what the env said, and the DB only
// takes over once an admin actually touches a toggle.
const ENV_FALLBACK: Record<WhatsAppAutomation, string> = {
  invoiceAutoSend: 'WHATSAPP_AUTO_SEND_ENABLED',
  paymentReceipt: 'WHATSAPP_AUTO_SEND_ENABLED',
  saleReminder: 'WHATSAPP_SALE_REMINDER_ENABLED',
  lowStock: 'WHATSAPP_LOW_STOCK_ENABLED',
  orderDispatched: 'WHATSAPP_ORDER_DISPATCHED_ENABLED',
};

// Short cache so a burst of invoices doesn't do a DB lookup per event. The
// cost is that a toggle takes up to this long to take effect — acceptable, and
// far simpler than invalidating across Cloud Run instances.
const CACHE_TTL_MS = 30_000;

type StoredFlags = Partial<Record<WhatsAppAutomation, boolean>>;

@Injectable()
export class WhatsAppSettingsService {
  private readonly logger = new Logger(WhatsAppSettingsService.name);
  private cache: { at: number; flags: StoredFlags } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async isEnabled(flag: WhatsAppAutomation): Promise<boolean> {
    // Master kill switch, env-only and deliberately above the DB flags: if
    // something goes wrong you need a way to stop every outbound message that
    // does NOT depend on the database or the admin UI being reachable.
    if (process.env.WHATSAPP_AUTO_SEND_ENABLED !== 'true') return false;

    try {
      const flags = await this.load();
      const stored = flags[flag];
      if (typeof stored === 'boolean') return stored;
      return process.env[ENV_FALLBACK[flag]] === 'true';
    } catch (e: unknown) {
      // Fail SAFE. If we can't confirm the setting, don't send — a message that
      // didn't go out can be resent; one that shouldn't have gone out can't be
      // recalled.
      this.logger.error(
        `could not read ${WHATSAPP_AUTOMATION_KEY} (${e instanceof Error ? e.message : String(e)}) — treating "${flag}" as OFF`,
      );
      return false;
    }
  }

  // Current effective state of every flag — what the Settings screen renders.
  async getAll(): Promise<Record<WhatsAppAutomation, boolean>> {
    const keys = Object.keys(ENV_FALLBACK) as WhatsAppAutomation[];
    const entries = await Promise.all(keys.map(async (k) => [k, await this.isEnabled(k)] as const));
    return Object.fromEntries(entries) as Record<WhatsAppAutomation, boolean>;
  }

  async setFlags(patch: StoredFlags): Promise<Record<WhatsAppAutomation, boolean>> {
    const current = await this.load().catch(() => ({} as StoredFlags));
    // Only accept known keys — never persist arbitrary client input.
    const allowed = Object.keys(ENV_FALLBACK) as WhatsAppAutomation[];
    const next: StoredFlags = { ...current };
    for (const k of allowed) {
      if (typeof patch[k] === 'boolean') next[k] = patch[k];
    }
    await this.prisma.globalSetting.upsert({
      where: { key: WHATSAPP_AUTOMATION_KEY },
      update: { value: next as object },
      create: { key: WHATSAPP_AUTOMATION_KEY, value: next as object },
    });
    this.cache = { at: Date.now(), flags: next };
    this.logger.log(`whatsapp automation updated: ${JSON.stringify(next)}`);
    return this.getAll();
  }

  private async load(): Promise<StoredFlags> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.flags;
    const row = await this.prisma.globalSetting.findUnique({
      where: { key: WHATSAPP_AUTOMATION_KEY },
    });
    const flags = (row?.value ?? {}) as StoredFlags;
    this.cache = { at: Date.now(), flags };
    return flags;
  }
}
