import {
  Controller,
  Get,
  Post,
  Query,
  Headers,
  Req,
  Res,
  HttpCode,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { WebhookEventStatus } from '@prisma/client';

// PUBLIC ENDPOINT — Meta hits this server-to-server. Two handlers:
//   GET  — webhook URL verification (hub.challenge echo) at registration time
//   POST — runtime events (delivery status, inbound messages)
@Controller('api/v1/webhooks/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  // Meta calls this once when you save the webhook URL in Business Manager.
  // We must echo `hub.challenge` if `hub.verify_token` matches the secret
  // we configured locally.
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const expected = process.env.META_VERIFY_TOKEN;
    if (mode === 'subscribe' && token && expected && token === expected) {
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send('forbidden');
  }

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: Request,
    @Headers('x-hub-signature-256') signature: string,
  ) {
    const rawBody: Buffer | undefined = (req as any).rawBody;
    if (!rawBody) return { ok: false, reason: 'rawBody missing' };

    const appSecret = process.env.META_APP_SECRET;
    let valid = false;
    if (appSecret && signature) {
      const expected =
        'sha256=' +
        crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
      try {
        const a = Buffer.from(signature, 'utf8');
        const b = Buffer.from(expected, 'utf8');
        valid = a.length === b.length && crypto.timingSafeEqual(a, b);
      } catch {
        valid = false;
      }
    }

    let body: any = {};
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      // ignore
    }

    // Meta uses payload.id as the event id for `entry` objects.
    const providerEventId =
      body?.entry?.[0]?.id ?? `meta_${Date.now()}_${Math.random()}`;

    let row;
    try {
      row = await this.prisma.webhookEvent.create({
        data: {
          provider: 'META',
          eventType: 'whatsapp_event',
          providerEventId: `${providerEventId}_${Date.now()}`, // Meta events are not always unique; we append timestamp
          payloadJson: body,
          signatureValid: valid,
          status: valid ? WebhookEventStatus.RECEIVED : WebhookEventStatus.INVALID_SIGNATURE,
        },
      });
    } catch {
      return { ok: true, duplicate: true };
    }

    if (!valid && appSecret) {
      this.logger.warn('Invalid Meta webhook signature — recorded for audit');
      return { ok: false, reason: 'invalid_signature' };
    }

    try {
      const entries: any[] = body?.entry ?? [];
      for (const entry of entries) {
        const changes: any[] = entry?.changes ?? [];
        for (const ch of changes) {
          const value = ch?.value ?? {};
          const statuses: any[] = value?.statuses ?? [];
          for (const s of statuses) {
            const wamid: string = s?.id;
            const status: string = s?.status; // sent | delivered | read | failed
            const err = s?.errors?.[0];
            if (wamid && status) {
              await this.whatsapp.applyStatusUpdate(
                wamid,
                status as any,
                err?.code ? String(err.code) : undefined,
                err?.message ?? err?.title ?? undefined,
              );
            }
          }
          // Inbound messages (`value.messages`) — not yet handled. Future:
          // wire two-way conversation, opt-out keywords ("STOP"), etc.
        }
      }

      await this.prisma.webhookEvent.update({
        where: { id: row.id },
        data: { status: WebhookEventStatus.PROCESSED, processedAt: new Date() },
      });
    } catch (e: any) {
      this.logger.error(`Meta webhook processing failed: ${e?.message ?? e}`);
      await this.prisma.webhookEvent.update({
        where: { id: row.id },
        data: { status: WebhookEventStatus.FAILED, errorMessage: String(e?.message ?? e) },
      });
    }

    return { ok: true };
  }
}
