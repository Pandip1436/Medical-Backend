import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppMessageStatus } from '@prisma/client';
import { timeoutFromEnv } from '../common/utils/with-timeout.util';

// Thin wrapper around Meta Graph API for WhatsApp Cloud.
//   https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
//
// All sends persist a WhatsAppMessage row so we have an audit trail + a
// retry queue (whatsapp-retry.service sweeps FAILED rows on a cron).

export interface SendTemplateInput {
  to: string;                          // E.164 without +, e.g. "919876543210"
  template: any;                       // payload from templates/*.ts
  templateName: string;                // for audit
  mediaUrl?: string;                   // for audit
  bodySnapshot?: string;               // rendered text for audit
  // Serialized template input vars. Persisted so the retry sweeper can
  // rebuild the Meta template payload without re-firing the source event —
  // required for notification-driven senders (low-stock supplier, sale
  // reminder) where re-firing would risk duplicating the underlying
  // notification row.
  templateVars?: Record<string, any>;
  relatedEntityType?: string;
  relatedEntityId?: string;
  branchId?: string | null;
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private readonly prisma: PrismaService) {}

  private get apiBase(): string {
    const ver = process.env.META_GRAPH_API_VERSION ?? 'v22.0';
    return `https://graph.facebook.com/${ver}`;
  }

  private get phoneNumberId(): string | null {
    return process.env.META_PHONE_NUMBER_ID ?? null;
  }

  private get token(): string | null {
    return process.env.META_WHATSAPP_TOKEN ?? null;
  }

  isConfigured(): boolean {
    return !!(this.phoneNumberId && this.token);
  }

  // Normalise to E.164 without +. Defaults to India (91) when 10 digits.
  static normalisePhone(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10) return `91${digits}`;
    if (digits.startsWith('0') && digits.length === 11) return `91${digits.slice(1)}`;
    return digits;
  }

  async sendTemplate(input: SendTemplateInput): Promise<{ id: string; providerMessageId: string | null }> {
    const to = WhatsAppService.normalisePhone(input.to);

    const row = await this.prisma.whatsAppMessage.create({
      data: {
        to,
        templateName: input.templateName,
        messageBody: input.bodySnapshot,
        mediaUrl: input.mediaUrl,
        templateVars: (input.templateVars ?? undefined) as any,
        status: WhatsAppMessageStatus.QUEUED,
        relatedEntityType: input.relatedEntityType,
        relatedEntityId: input.relatedEntityId,
        branchId: input.branchId ?? null,
        attempts: 0,
      },
    });

    if (!this.isConfigured()) {
      this.logger.warn(
        `META_WHATSAPP_TOKEN / META_PHONE_NUMBER_ID not set — message ${row.id} stays QUEUED`,
      );
      return { id: row.id, providerMessageId: null };
    }

    const url = `${this.apiBase}/${this.phoneNumberId}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: input.template,
    };

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        // fetch() has no default timeout: a stalled connection to Graph would
        // otherwise hang the whole send flow (and its in-flight guard) forever.
        // On abort we land in the catch below and the row is marked FAILED, so
        // the retry sweeper picks it up normally.
        signal: AbortSignal.timeout(timeoutFromEnv('META_TIMEOUT_MS', 30_000)),
      });
    } catch (e: any) {
      await this.prisma.whatsAppMessage.update({
        where: { id: row.id },
        data: {
          status: WhatsAppMessageStatus.FAILED,
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
          errorMessage: `network: ${e?.message ?? e}`,
        },
      });
      throw e;
    }

    const json: any = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      const errCode = json?.error?.code ? String(json.error.code) : `http_${resp.status}`;
      const errMsg = json?.error?.message ?? JSON.stringify(json);
      await this.prisma.whatsAppMessage.update({
        where: { id: row.id },
        data: {
          status: WhatsAppMessageStatus.FAILED,
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
          errorCode: errCode,
          errorMessage: errMsg,
        },
      });
      this.logger.error(`Meta send failed (${errCode}): ${errMsg}`);
      return { id: row.id, providerMessageId: null };
    }

    const wamid: string | undefined = json?.messages?.[0]?.id;
    await this.prisma.whatsAppMessage.update({
      where: { id: row.id },
      data: {
        status: WhatsAppMessageStatus.SENT,
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
        providerMessageId: wamid ?? null,
      },
    });
    return { id: row.id, providerMessageId: wamid ?? null };
  }

  // Used by the WhatsApp webhook controller to apply delivery status updates.
  //
  // Status is MONOTONIC — QUEUED → SENT → DELIVERED → READ — and `failed` may
  // only apply to a message that hasn't been delivered yet. Meta sometimes
  // sends a late or duplicate `failed` AFTER a `delivered`; honoring it would
  // resurrect a delivered message back into the retry queue and drive the
  // resend loop. So each update is guarded to never regress past a later state.
  async applyStatusUpdate(wamid: string, status: 'sent' | 'delivered' | 'read' | 'failed', errorCode?: string, errorMessage?: string) {
    const S = WhatsAppMessageStatus;
    const map: Record<string, WhatsAppMessageStatus> = {
      sent: S.SENT,
      delivered: S.DELIVERED,
      read: S.READ,
      failed: S.FAILED,
    };
    // Don't overwrite a status that already represents a later lifecycle state.
    const guardNotIn: Record<string, WhatsAppMessageStatus[]> = {
      failed: [S.DELIVERED, S.READ],
      sent: [S.DELIVERED, S.READ],
      delivered: [S.READ],
      read: [],
    };
    const notIn = guardNotIn[status] ?? [];
    await this.prisma.whatsAppMessage.updateMany({
      where: {
        providerMessageId: wamid,
        ...(notIn.length ? { status: { notIn } } : {}),
      },
      data: {
        status: map[status] ?? S.SENT,
        errorCode: errorCode ?? null,
        errorMessage: errorMessage ?? null,
      },
    });
  }
}
