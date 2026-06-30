import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  IndiamartQueryType as PrismaIndiamartQueryType,
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

// Push API integration with IndiaMART. The seller pastes our URL into their
// Lead Manager → Push API panel; IndiaMART then POSTs every new inquiry
// (Direct, Buy-Lead, PNS, Catalog, WhatsApp) to that URL in real-time.
//
// Auth model is URL secrecy — IndiaMART doesn't send any auth headers, so
// the path-level `webhookToken` is the only thing protecting the endpoint.
// Tokens are 32 random bytes (base64url, 43 chars).

const WEBHOOK_PATH = '/api/v1/integrations/indiamart/webhook';

@Injectable()
export class IndiamartService {
  private readonly logger = new Logger(IndiamartService.name);

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
    // Where this backend is reachable from the public internet. Production
    // expects APP_PUBLIC_URL set to the real HTTPS origin (no trailing /).
    // Dev: fall back to localhost so the "Generate" and "Send Test Push"
    // flows still work without an ngrok tunnel — IndiaMART won't be able to
    // reach localhost, but the test button calls our service directly so
    // that doesn't matter for verification.
    const url = process.env.APP_PUBLIC_URL?.trim();
    if (url) return url.replace(/\/+$/, '');
    const port = process.env.PORT?.trim() || '3001';
    this.logger.warn(
      `APP_PUBLIC_URL not set — using http://localhost:${port} for the webhook URL. Set APP_PUBLIC_URL before pasting into IndiaMART.`,
    );
    return `http://localhost:${port}`;
  }

  private buildWebhookUrl(token: string): string {
    return `${this.appBaseUrl()}${WEBHOOK_PATH}/${token}`;
  }

  private newToken(): string {
    // 32 bytes → 43 char base64url. Random, unguessable, URL-safe.
    return randomBytes(32)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /** Idempotent: returns the existing URL if already generated, else makes one. */
  async getOrCreateWebhook(branchId: string) {
    const existing = await this.prisma.integrationCredential.findUnique({
      where: {
        provider_branchId: {
          provider: IntegrationProvider.INDIAMART,
          branchId,
        },
      },
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
      where: {
        provider_branchId: {
          provider: IntegrationProvider.INDIAMART,
          branchId,
        },
      },
      create: {
        provider: IntegrationProvider.INDIAMART,
        branchId,
        webhookToken: token,
        isActive: true,
      },
      update: {
        webhookToken: token,
        isActive: true,
        cooldownUntil: null,
      },
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
      where: {
        provider_branchId: {
          provider: IntegrationProvider.INDIAMART,
          branchId,
        },
      },
      data: { webhookToken: token, isActive: true },
    });
    return { url: this.buildWebhookUrl(token), createdAt: row.updatedAt };
  }

  /** Soft-disconnect — marks inactive but keeps token so the URL stays unique. */
  async disconnect(branchId: string) {
    return this.prisma.integrationCredential.updateMany({
      where: { provider: IntegrationProvider.INDIAMART, branchId },
      data: { isActive: false },
    });
  }

  async getStatus(branchId: string) {
    const cred = await this.prisma.integrationCredential.findUnique({
      where: {
        provider_branchId: {
          provider: IntegrationProvider.INDIAMART,
          branchId,
        },
      },
    });
    const lastJob = await this.prisma.integrationSyncJob.findFirst({
      where: { provider: IntegrationProvider.INDIAMART, branchId },
      orderBy: { startedAt: 'desc' },
    });
    // 7 days without a single push usually means the seller hasn't completed
    // their OTP yet OR pasted a wrong URL. Surface a hint so the user notices.
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
      where: { provider: IntegrationProvider.INDIAMART, branchId },
      orderBy: { startedAt: 'desc' },
      take: Math.min(100, Math.max(1, limit)),
    });
  }

  // ───────────────────────────────────────────────────────────────
  // Test push — synthesize a realistic payload + drop it into the
  // receiver pipeline. Used by the "Send Test Push" button so admins can
  // verify the full integration before a real IndiaMART account is wired.
  // ───────────────────────────────────────────────────────────────

  async sendTestPush(branchId: string) {
    // Ensure a webhook exists for this branch — the test bypasses HTTP but
    // still needs a valid token in the DB so the lookup inside
    // handleIncomingPush() succeeds.
    const generated = await this.getOrCreateWebhook(branchId);
    const cred = await this.prisma.integrationCredential.findUnique({
      where: {
        provider_branchId: {
          provider: IntegrationProvider.INDIAMART,
          branchId,
        },
      },
    });
    if (!cred || !cred.webhookToken) {
      throw new Error('Could not provision a webhook token for the test push');
    }

    // Random UNIQUE_QUERY_ID so repeated test clicks all land as fresh leads
    // (instead of bouncing off the dedup check). The shape mirrors a real
    // Buy-Lead push from IndiaMART's docs example.
    const fakeId = `TEST-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const queryTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const payload = {
      CODE: 200,
      STATUS: 'SUCCESS',
      RESPONSE: {
        UNIQUE_QUERY_ID: fakeId,
        QUERY_TYPE: 'B',
        QUERY_TIME: queryTime,
        SENDER_NAME: 'Test Buyer',
        SENDER_MOBILE: '9876543210',
        SENDER_EMAIL: 'testbuyer@example.com',
        SENDER_COMPANY: 'Test Pharmacy Ltd',
        SENDER_ADDRESS: '123 MG Road',
        SENDER_CITY: 'Bengaluru',
        SENDER_STATE: 'Karnataka',
        SENDER_PINCODE: '560001',
        SENDER_COUNTRY_ISO: 'IN',
        SUBJECT: 'Paracetamol 500mg',
        QUERY_PRODUCT_NAME: 'Paracetamol 500mg Tab',
        QUERY_MCAT_NAME: 'OTC Medicines',
        QUERY_MESSAGE:
          'Requirement for Paracetamol 500mg\nQuantity: 5000 Strips\nUsage: Hospital\nThis is a TEST lead generated by the integration self-check button.',
      },
    };

    const result = await this.handleIncomingPush(
      cred.webhookToken,
      payload,
    );
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

  /**
   * Process a single inbound webhook from IndiaMART. Returns `true` on
   * success (HTTP 200 to caller) — anything that throws becomes a 5xx
   * and IndiaMART retries automatically.
   *
   * The payload IndiaMART sends has either a flat lead at the top or
   * nested under `RESPONSE` (their docs example shows the latter inside
   * a `body` envelope). We try both, in that order.
   */
  async handleIncomingPush(
    token: string,
    payload: Record<string, unknown>,
  ): Promise<{ accepted: boolean; unique_query_id: string | null }> {
    // O(1) lookup on the unique token. Endpoint stays fast — the whole
    // request budget per IndiaMART's spec is ~10s.
    const cred = await this.prisma.integrationCredential.findUnique({
      where: { webhookToken: token },
    });
    if (!cred || !cred.isActive) {
      // Don't reveal whether the token exists — just 404. IndiaMART's
      // retry logic treats 4xx as terminal, which is what we want here:
      // a wrong/expired URL should not trigger 48h of retries.
      throw new NotFoundException('Webhook URL not active');
    }

    const lead = this.extractLead(payload);
    // Always open an audit row first. Even invalid payloads get logged
    // so the user can see what IndiaMART sent.
    const job = await this.prisma.integrationSyncJob.create({
      data: {
        provider: IntegrationProvider.INDIAMART,
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
        errorMessage: 'Payload did not contain a recognizable lead body',
        rawResponseSize: JSON.stringify(payload).length,
      });
      // Return 200 so IndiaMART doesn't retry malformed payloads forever.
      return { accepted: true, unique_query_id: null };
    }

    const uniqueId = this.normalizeQueryId(lead.UNIQUE_QUERY_ID) || null;
    if (!uniqueId) {
      await this.finishJob(job.id, {
        status: SyncJobStatus.FAILED,
        errorCode: 422,
        errorMessage: 'UNIQUE_QUERY_ID missing — cannot dedup',
        rawResponseSize: JSON.stringify(payload).length,
      });
      return { accepted: true, unique_query_id: null };
    }

    try {
      const created = await this.upsertLeadAndContact(cred.branchId, lead);
      await this.prisma.integrationCredential.update({
        where: { id: cred.id },
        data: { lastVerifiedAt: new Date() },
      });
      await this.finishJob(job.id, {
        status: created
          ? SyncJobStatus.SUCCESS
          : SyncJobStatus.NO_NEW_LEADS,
        newLeadsCount: created ? 1 : 0,
        dupeSkippedCount: created ? 0 : 1,
        rawResponseSize: JSON.stringify(payload).length,
      });
      return { accepted: true, unique_query_id: uniqueId };
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
        title: 'IndiaMART push failed',
        message: `Lead ${uniqueId} could not be saved: ${message}`,
        branchId: cred.branchId,
        actionUrl: '/settings',
      });
      // Throw so the controller returns 500 → IndiaMART will retry. This
      // is the right behavior for transient errors (DB hiccup, etc.).
      throw err;
    }
  }

  // The doc's example shows the lead either flat at the top or one level
  // deep under `RESPONSE`. Some integration test tools also wrap the whole
  // thing inside a `body` key. Probe in that order and return the first
  // object that looks like a lead.
  private extractLead(
    payload: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const candidates: Array<Record<string, unknown> | null> = [
      payload,
      this.asObject(payload.RESPONSE),
      this.asObject(payload.body),
      this.asObject(this.asObject(payload.body)?.RESPONSE),
    ];
    for (const c of candidates) {
      if (c && typeof c.UNIQUE_QUERY_ID === 'string') return c;
    }
    return null;
  }

  private asObject(v: unknown): Record<string, unknown> | null {
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  }

  // ───────────────────────────────────────────────────────────────
  // Lead + contact upsert (shared between push + future manual flows)
  // ───────────────────────────────────────────────────────────────

  // Returns true if a NEW Lead was created, false if existing (dupe).
  private async upsertLeadAndContact(
    branchId: string,
    item: Record<string, unknown>,
  ): Promise<boolean> {
    const uniqueQueryId = this.normalizeQueryId(item.UNIQUE_QUERY_ID);
    const existing = await this.prisma.lead.findUnique({
      where: { externalQueryId: uniqueQueryId },
    });
    if (existing) {
      await this.prisma.lead.update({
        where: { id: existing.id },
        data: {
          externalMessage:
            this.cleanString(item.QUERY_MESSAGE) ?? existing.externalMessage,
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
        source: LeadSource.INDIAMART,
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
        externalQueryId: uniqueQueryId,
        externalQueryType: this.parseQueryType(item.QUERY_TYPE),
        externalQueryTime: this.parseQueryTime(item.QUERY_TIME),
        externalMessage: this.cleanString(item.QUERY_MESSAGE),
        externalProductName: this.cleanString(item.QUERY_PRODUCT_NAME),
        externalCategory: this.cleanString(item.QUERY_MCAT_NAME),
        externalCity: this.cleanString(item.SENDER_CITY),
        externalState: this.cleanString(item.SENDER_STATE),
        externalCountryIso: this.cleanString(item.SENDER_COUNTRY_ISO),
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
    const phone = this.normalizePhone(item.SENDER_MOBILE ?? item.SENDER_PHONE);
    const email = this.cleanString(item.SENDER_EMAIL);

    if (phone || email) {
      const existing = await this.contacts.findByPhoneOrEmail(branchId, {
        phone: phone ?? undefined,
        email: email ?? undefined,
      });
      if (existing) return existing.id;
    }

    const created = await this.contacts.create(
      {
        firstName: this.cleanString(item.SENDER_NAME) ?? 'IndiaMART Buyer',
        phone: phone ?? `0000${Date.now().toString().slice(-6)}`,
        phoneCountryCode: '+91',
        email: email ?? undefined,
        city: this.cleanString(item.SENDER_CITY) ?? undefined,
        state: this.cleanString(item.SENDER_STATE) ?? undefined,
        country: this.cleanString(item.SENDER_COUNTRY_ISO) ?? undefined,
        source: 'INDIAMART',
      },
      { branchId, userId: ownerUserId },
    );
    return created.id;
  }

  // Cache to avoid hitting the user table on every push during a burst.
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
      this.ownerCache.set(branchId, {
        id: admin.id,
        expires: Date.now() + 5 * 60 * 1000,
      });
      return admin.id;
    }
    const anyAdmin = await this.prisma.user.findFirst({
      where: { role: { in: adminRoles }, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!anyAdmin) {
      throw new Error('No active admin user exists to own IndiaMART leads');
    }
    this.ownerCache.set(branchId, {
      id: anyAdmin.id,
      expires: Date.now() + 5 * 60 * 1000,
    });
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

  private deriveTitle(item: Record<string, unknown>): string {
    const product = this.cleanString(item.QUERY_PRODUCT_NAME);
    if (product) return product;
    const msg = this.cleanString(item.QUERY_MESSAGE);
    if (msg) {
      const firstLine = msg.split(/\r?\n/)[0]?.trim();
      if (firstLine) return firstLine.slice(0, 80);
    }
    return 'IndiaMART inquiry';
  }

  private cleanString(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const trimmed = v.trim();
    return trimmed.length ? trimmed : null;
  }

  // Canonicalise UNIQUE_QUERY_ID to a stable string. IndiaMART occasionally
  // delivers it as a Buffer / byte-array (the ASCII char codes of the digits)
  // instead of a plain value; a naive String() then yields a DIFFERENT string
  // for the same inquiry (e.g. "1270207732" vs "49,50,55,..."), which slipped
  // past the externalQueryId dedup and created duplicate leads. Decode all
  // byte-ish shapes back to the underlying string so the same query always
  // maps to the same id.
  private normalizeQueryId(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number' || typeof v === 'bigint') return String(v);
    if (Buffer.isBuffer(v)) return v.toString('utf8').trim();
    if (v instanceof Uint8Array) return Buffer.from(v).toString('utf8').trim();

    let s: string;
    if (typeof v === 'string') {
      s = v.trim();
    } else if (Array.isArray(v) && v.every((n) => typeof n === 'number')) {
      // Plain array of char codes: [49,50,55,...] → "127..."
      return String.fromCharCode(...(v as number[])).trim();
    } else {
      // Buffer serialised to JSON: { type: 'Buffer', data: [49,50,...] }
      const data = (v as { data?: unknown }).data;
      if (Array.isArray(data) && data.every((n) => typeof n === 'number')) {
        return String.fromCharCode(...(data as number[])).trim();
      }
      s = String(v).trim();
    }

    // Catch-all: a value that stringified to a char-code list, e.g.
    // "[49 50 55 48]", "49,50,55,48" or "{49,50}". A genuine query id is a
    // single token, so this only fires on the (≥2 numbers) corrupted form;
    // the printable-ASCII guard keeps us from mangling real numeric ids.
    const m = s.match(/^[[{(]?\s*(\d+(?:[\s,]+\d+)+)\s*[)}\]]?$/);
    if (m) {
      const codes = m[1].split(/[\s,]+/).map(Number);
      if (codes.every((n) => n >= 32 && n <= 126)) {
        return String.fromCharCode(...codes).trim();
      }
    }
    return s;
  }

  private normalizePhone(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const digits = v.replace(/\D/g, '');
    if (!digits) return null;
    return digits.length > 10 ? digits.slice(-10) : digits;
  }

  private parseQueryType(v: unknown): PrismaIndiamartQueryType | null {
    if (typeof v !== 'string') return null;
    const upper = v.trim().toUpperCase();
    if (
      upper === 'W' ||
      upper === 'B' ||
      upper === 'P' ||
      upper === 'BIZ' ||
      upper === 'WA'
    ) {
      return upper as PrismaIndiamartQueryType;
    }
    return null;
  }

  private parseQueryTime(v: unknown): Date | null {
    if (typeof v !== 'string') return null;
    // IndiaMART sends "2024-04-10 11:17:14" (space-separated, IST). Convert
    // to ISO and parse; treat as IST since they don't include a TZ marker.
    const iso = v.replace(' ', 'T');
    const direct = new Date(iso);
    if (!isNaN(direct.getTime())) return direct;
    return null;
  }
}
