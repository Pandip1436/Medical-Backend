import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  IntegrationProvider,
  LeadSource,
  LeadStage,
  LeadStatus,
  LeadTouchStatus,
  LeadPipeline,
  Role,
  SyncJobStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ContactsService } from '../contacts/contacts.service';
import { LeadNumberingService } from '../leads/lead-numbering.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/dto/create-notification.dto';

// Push integration with Just Dial — the supplier pastes our URL into their
// Just Dial Lead Manager / Leads-API panel, and Just Dial POSTs every new lead
// (call / enquiry / WhatsApp) to that URL in real time.
//
// Mirrors the IndiaMART integration exactly: no polling, no scheduler, no
// outbound HTTP — purely a receiver. Auth is URL secrecy via a 32-byte token
// in the path. Just Dial's field names differ from IndiaMART's, so only the
// payload mapping below changes.
const WEBHOOK_PATH = '/api/v1/integrations/justdial/webhook';
const PROVIDER = IntegrationProvider.JUSTDIAL;

@Injectable()
export class JustdialService {
  private readonly logger = new Logger(JustdialService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly numbering: LeadNumberingService,
    private readonly notifications: NotificationsService,
  ) {}

  // ───────────────────────────────────────────────────────────────
  // Credential management — admin endpoints
  // ───────────────────────────────────────────────────────────────

  private appBaseUrl(): string {
    const url = process.env.APP_PUBLIC_URL?.trim();
    if (url) return url.replace(/\/+$/, '');
    const port = process.env.PORT?.trim() || '3001';
    this.logger.warn(
      `APP_PUBLIC_URL not set — using http://localhost:${port} for the webhook URL. Set APP_PUBLIC_URL before pasting into Just Dial.`,
    );
    return `http://localhost:${port}`;
  }

  private buildWebhookUrl(token: string): string {
    return `${this.appBaseUrl()}${WEBHOOK_PATH}/${token}`;
  }

  private newToken(): string {
    return randomBytes(32)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /** Idempotent: returns the existing URL if already generated, else makes one. */
  async getOrCreateWebhook(branchId: string) {
    const existing = await this.prisma.integrationCredential.findUnique({
      where: { provider_branchId: { provider: PROVIDER, branchId } },
    });
    if (existing && existing.webhookToken && existing.isActive) {
      return {
        url: this.buildWebhookUrl(existing.webhookToken),
        createdAt: existing.createdAt,
        regenerated: false,
      };
    }
    const token = this.newToken();
    const row = await this.prisma.integrationCredential.upsert({
      where: { provider_branchId: { provider: PROVIDER, branchId } },
      create: { provider: PROVIDER, branchId, webhookToken: token, isActive: true },
      update: { webhookToken: token, isActive: true, cooldownUntil: null },
    });
    return {
      url: this.buildWebhookUrl(token),
      createdAt: row.createdAt,
      regenerated: !!existing,
    };
  }

  /** Mints a new token (invalidates the old URL). Use when token may be leaked. */
  async rotateWebhook(branchId: string) {
    const token = this.newToken();
    const row = await this.prisma.integrationCredential.update({
      where: { provider_branchId: { provider: PROVIDER, branchId } },
      data: { webhookToken: token, isActive: true },
    });
    return { url: this.buildWebhookUrl(token), createdAt: row.updatedAt };
  }

  /** Soft-disconnect — marks inactive but keeps token so the URL stays unique. */
  async disconnect(branchId: string) {
    return this.prisma.integrationCredential.updateMany({
      where: { provider: PROVIDER, branchId },
      data: { isActive: false },
    });
  }

  async getStatus(branchId: string) {
    const cred = await this.prisma.integrationCredential.findUnique({
      where: { provider_branchId: { provider: PROVIDER, branchId } },
    });
    const lastJob = await this.prisma.integrationSyncJob.findFirst({
      where: { provider: PROVIDER, branchId },
      orderBy: { startedAt: 'desc' },
    });
    const stale =
      cred?.isActive &&
      cred?.lastVerifiedAt &&
      Date.now() - new Date(cred.lastVerifiedAt).getTime() >
        7 * 24 * 60 * 60 * 1000;
    return {
      connected: !!cred && cred.isActive && !!cred.webhookToken,
      isActive: cred?.isActive ?? false,
      webhookUrl:
        cred?.webhookToken && cred.isActive
          ? this.buildWebhookUrl(cred.webhookToken)
          : null,
      lastReceivedAt: cred?.lastVerifiedAt ?? null,
      createdAt: cred?.createdAt ?? null,
      stale: !!stale,
      lastJob: lastJob
        ? {
            id: lastJob.id,
            status: lastJob.status,
            startedAt: lastJob.startedAt,
            finishedAt: lastJob.finishedAt,
            newLeadsCount: lastJob.newLeadsCount,
            dupeSkippedCount: lastJob.dupeSkippedCount,
            errorCode: lastJob.errorCode,
            errorMessage: lastJob.errorMessage,
          }
        : null,
    };
  }

  async getJobs(branchId: string, limit = 25) {
    return this.prisma.integrationSyncJob.findMany({
      where: { provider: PROVIDER, branchId },
      orderBy: { startedAt: 'desc' },
      take: Math.min(100, Math.max(1, limit)),
    });
  }

  // ───────────────────────────────────────────────────────────────
  // Test push — synthesize a realistic Just Dial payload and drop it into the
  // receiver pipeline so admins can verify the wiring before a live account.
  // ───────────────────────────────────────────────────────────────

  async sendTestPush(branchId: string) {
    const generated = await this.getOrCreateWebhook(branchId);
    const cred = await this.prisma.integrationCredential.findUnique({
      where: { provider_branchId: { provider: PROVIDER, branchId } },
    });
    if (!cred || !cred.webhookToken) {
      throw new Error('Could not provision a webhook token for the test push');
    }

    const fakeId = `TEST-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    // Shape mirrors a Just Dial lead push (their field names).
    const payload = {
      leadid: fakeId,
      leadtype: 'Enquiry',
      name: 'Test Buyer',
      mobile: '9876543210',
      email: 'testbuyer@example.com',
      company: 'Test Pharmacy Ltd',
      category: 'OTC Medicines',
      city: 'Bengaluru',
      area: 'MG Road',
      pincode: '560001',
      date: dateTime,
      requirement:
        'Requirement for Paracetamol 500mg. Quantity: 5000 Strips. This is a TEST lead generated by the integration self-check button.',
    };

    const result = await this.handleIncomingPush(cred.webhookToken, payload);
    return {
      ok: true,
      unique_query_id: result.unique_query_id,
      webhookUrl: generated.url,
      sampleMobile: '9876543210',
    };
  }

  // ───────────────────────────────────────────────────────────────
  // Webhook receiver — called by the public controller
  // ───────────────────────────────────────────────────────────────

  async handleIncomingPush(
    token: string,
    payload: Record<string, unknown>,
  ): Promise<{ accepted: boolean; unique_query_id: string | null }> {
    const cred = await this.prisma.integrationCredential.findUnique({
      where: { webhookToken: token },
    });
    if (!cred || !cred.isActive) {
      throw new NotFoundException('Webhook URL not active');
    }

    const lead = this.extractLead(payload);
    const job = await this.prisma.integrationSyncJob.create({
      data: {
        provider: PROVIDER,
        branchId: cred.branchId,
        startTime: new Date(),
        endTime: new Date(),
        status: SyncJobStatus.RUNNING,
        totalRecords: lead ? 1 : 0,
      },
    });

    if (!lead) {
      await this.finishJob(job.id, {
        status: SyncJobStatus.FAILED,
        errorCode: 422,
        errorMessage: 'Payload did not contain a recognizable Just Dial lead',
        rawResponseSize: JSON.stringify(payload).length,
      });
      return { accepted: true, unique_query_id: null };
    }

    const leadId = this.leadId(lead);
    if (!leadId) {
      await this.finishJob(job.id, {
        status: SyncJobStatus.FAILED,
        errorCode: 422,
        errorMessage: 'Lead id (leadid) missing — cannot dedup',
        rawResponseSize: JSON.stringify(payload).length,
      });
      return { accepted: true, unique_query_id: null };
    }

    try {
      const created = await this.upsertLeadAndContact(cred.branchId, lead, leadId);
      await this.prisma.integrationCredential.update({
        where: { id: cred.id },
        data: { lastVerifiedAt: new Date() },
      });
      await this.finishJob(job.id, {
        status: created ? SyncJobStatus.SUCCESS : SyncJobStatus.NO_NEW_LEADS,
        newLeadsCount: created ? 1 : 0,
        dupeSkippedCount: created ? 0 : 1,
        rawResponseSize: JSON.stringify(payload).length,
      });
      return { accepted: true, unique_query_id: leadId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[webhook] upsert failed for branch ${cred.branchId}: ${message}`,
      );
      await this.finishJob(job.id, {
        status: SyncJobStatus.FAILED,
        errorCode: 500,
        errorMessage: message,
        rawResponseSize: JSON.stringify(payload).length,
      });
      await this.notifications.create({
        type: NotificationType.SYSTEM,
        title: 'Just Dial push failed',
        message: `Lead ${leadId} could not be saved: ${message}`,
        branchId: cred.branchId,
        actionUrl: '/settings',
      });
      throw err;
    }
  }

  // Just Dial may send the lead flat at the top, or nested under `lead` /
  // `data` / `RESPONSE` / `body`. Probe in that order; the first object with a
  // recognizable lead-id field wins.
  private extractLead(
    payload: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const candidates: Array<Record<string, unknown> | null> = [
      payload,
      this.asObject(payload.lead),
      this.asObject(payload.data),
      this.asObject(payload.RESPONSE),
      this.asObject(payload.body),
      this.asObject(this.asObject(payload.body)?.lead),
    ];
    for (const c of candidates) {
      if (c && this.leadId(c)) return c;
    }
    return null;
  }

  private asObject(v: unknown): Record<string, unknown> | null {
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  }

  // ───────────────────────────────────────────────────────────────
  // Lead + contact upsert
  // ───────────────────────────────────────────────────────────────

  // Returns true if a NEW Lead was created, false if existing (dupe).
  private async upsertLeadAndContact(
    branchId: string,
    item: Record<string, unknown>,
    leadId: string,
  ): Promise<boolean> {
    // Namespace Just Dial ids so they can never collide with IndiaMART's.
    const externalId = `JD-${leadId}`;
    const message = this.pick(item, ['requirement', 'message', 'query', 'remarks']);

    const existing = await this.prisma.lead.findUnique({
      where: { externalQueryId: externalId },
    });
    if (existing) {
      await this.prisma.lead.update({
        where: { id: existing.id },
        data: {
          externalMessage: message ?? existing.externalMessage,
          externalRaw: item as unknown as object,
        },
      });
      return false;
    }

    const ownerUserId = await this.pickDefaultOwner(branchId);
    const contactId = await this.ensureContact(branchId, ownerUserId, item);
    const leadNumber = await this.numbering.next();

    await this.prisma.lead.create({
      data: {
        leadNumber,
        title: this.deriveTitle(item),
        description: null,
        source: LeadSource.JUSTDIAL,
        pipeline: LeadPipeline.SALES,
        stage: LeadStage.LEAD,
        status: LeadStatus.OPEN,
        touchStatus: LeadTouchStatus.UNTOUCHED,
        score: 50,
        value: 0,
        currency: 'INR',
        contact: { connect: { id: contactId } },
        assignedToUser: { connect: { id: ownerUserId } },
        branch: { connect: { id: branchId } },
        externalQueryId: externalId,
        // externalQueryType is IndiaMART-specific (W/B/P/…) — left null for JD.
        externalQueryTime: this.parseTime(this.pick(item, ['date', 'datetime', 'leaddate', 'time'])),
        externalMessage: message,
        externalProductName: this.pick(item, ['product', 'productname', 'category', 'cat']),
        externalCategory: this.pick(item, ['category', 'cat']),
        externalCity: this.pick(item, ['city']),
        externalState: this.pick(item, ['area', 'state', 'brancharea']),
        externalCountryIso: 'IN',
        externalRaw: item as unknown as object,
      },
    });
    return true;
  }

  private async ensureContact(
    branchId: string,
    ownerUserId: string,
    item: Record<string, unknown>,
  ): Promise<string> {
    const phone = this.normalizePhone(
      this.pick(item, ['mobile', 'phone', 'mobile_number', 'phone_number', 'contact']),
    );
    const email = this.pick(item, ['email']);

    if (phone || email) {
      const existing = await this.contacts.findByPhoneOrEmail(branchId, {
        phone: phone ?? undefined,
        email: email ?? undefined,
      });
      if (existing) return existing.id;
    }

    const created = await this.contacts.create(
      {
        firstName: this.pick(item, ['name', 'customername', 'sender_name']) ?? 'Just Dial Lead',
        phone: phone ?? `0000${Date.now().toString().slice(-6)}`,
        phoneCountryCode: '+91',
        email: email ?? undefined,
        city: this.pick(item, ['city']) ?? undefined,
        state: this.pick(item, ['area', 'state']) ?? undefined,
        country: 'IN',
        source: 'JUSTDIAL',
      },
      { branchId, userId: ownerUserId },
    );
    return created.id;
  }

  private ownerCache = new Map<string, { id: string; expires: number }>();

  private async pickDefaultOwner(branchId: string): Promise<string> {
    const cached = this.ownerCache.get(branchId);
    if (cached && cached.expires > Date.now()) return cached.id;

    // "Admin-or-above" owns leads — SUPER_ADMIN counts as an admin here, same
    // as isAdminRole() in common/roles.util.ts. Prefer a branch admin, then
    // fall back to any active admin/super-admin in the system.
    const adminRoles = [Role.ADMIN, Role.SUPER_ADMIN];
    const admin = await this.prisma.user.findFirst({
      where: { branchId, role: { in: adminRoles }, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (admin) {
      this.ownerCache.set(branchId, { id: admin.id, expires: Date.now() + 5 * 60 * 1000 });
      return admin.id;
    }
    const anyAdmin = await this.prisma.user.findFirst({
      where: { role: { in: adminRoles }, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!anyAdmin) {
      throw new Error('No active admin user exists to own Just Dial leads');
    }
    this.ownerCache.set(branchId, { id: anyAdmin.id, expires: Date.now() + 5 * 60 * 1000 });
    return anyAdmin.id;
  }

  // ───────────────────────────────────────────────────────────────
  // Field helpers
  // ───────────────────────────────────────────────────────────────

  private finishJob(
    jobId: string,
    patch: Partial<{
      status: SyncJobStatus;
      totalRecords: number;
      newLeadsCount: number;
      dupeSkippedCount: number;
      errorCode: number | null;
      errorMessage: string | null;
      rawResponseSize: number;
    }>,
  ) {
    return this.prisma.integrationSyncJob.update({
      where: { id: jobId },
      data: { ...patch, finishedAt: new Date() },
    });
  }

  // Just Dial's lead id under any of its common key names.
  private leadId(item: Record<string, unknown>): string | null {
    return this.pick(item, ['leadid', 'lead_id', 'leadId', 'id', 'enquiryid']);
  }

  // First non-empty string value among the given (case-insensitive) keys.
  private pick(item: Record<string, unknown>, keys: string[]): string | null {
    const lower = new Map(
      Object.keys(item).map((k) => [k.toLowerCase(), k]),
    );
    for (const key of keys) {
      const actual = lower.get(key.toLowerCase());
      if (actual === undefined) continue;
      const v = item[actual];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
    }
    return null;
  }

  private deriveTitle(item: Record<string, unknown>): string {
    const cat = this.pick(item, ['category', 'cat', 'product', 'productname']);
    if (cat) return cat;
    const msg = this.pick(item, ['requirement', 'message', 'query']);
    if (msg) {
      const firstLine = msg.split(/\r?\n/)[0]?.trim();
      if (firstLine) return firstLine.slice(0, 80);
    }
    return 'Just Dial inquiry';
  }

  private normalizePhone(v: string | null): string | null {
    if (!v) return null;
    const digits = v.replace(/\D/g, '');
    if (!digits) return null;
    return digits.length > 10 ? digits.slice(-10) : digits;
  }

  private parseTime(v: string | null): Date | null {
    if (!v) return null;
    const iso = v.replace(' ', 'T');
    const direct = new Date(iso);
    if (!isNaN(direct.getTime())) return direct;
    return null;
  }
}
