import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SharedFilesService } from '../shared-files/shared-files.service';
import { WhatsAppRetryService } from '../whatsapp/whatsapp-retry.service';

// Single entry point for every scheduled job, driven by ONE external trigger
// (Cloud Scheduler / GitHub Actions / cron) hitting POST /api/v1/cron/tick.
//
// Why this exists at all: production runs on Cloud Run with CPU allocated only
// during request processing. Between requests the container is frozen and idle
// instances are reclaimed, so an in-process timer (`@Cron`, `setInterval`) does
// not fire — reminders only ever went out when a user's page load happened to
// cold-start the container. Running the same work inside an HTTP request means
// Cloud Run gives it CPU.
//
// One trigger covers all three jobs because Cloud Scheduler bills per job per
// month, not per execution — frequency is free, so a 5-minute tick that decides
// what is due costs the same as a monthly one.
//
// Everything here is idempotent: each daily task claims its slot atomically in
// the DB (see claim()), so overlapping ticks — Scheduler retries, or two Cloud
// Run instances — cannot run the same task twice.
@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly sharedFiles: SharedFilesService,
    private readonly whatsappRetry: WhatsAppRetryService,
  ) {}

  // Hour-of-day (IST) each daily task runs at. The process TZ is pinned to
  // Asia/Kolkata in main.ts, so local hours ARE IST.
  private static readonly DAILY_ALERTS_HOUR = 9;   // customer-facing WhatsApp
  private static readonly CLEANUP_HOUR = 3;        // housekeeping, off-peak

  async tick(): Promise<Record<string, unknown>> {
    const now = new Date();
    const hour = now.getHours();
    const today = this.dayKey(now);
    const result: Record<string, unknown> = { at: now.toISOString(), istHour: hour };

    // 1. WhatsApp retry sweep — every tick. Cheap by design: one indexed query
    //    for FAILED rows still under their attempt cap, and it returns straight
    //    away when there are none (the normal case). Nothing that delivered is
    //    ever touched.
    result.whatsappRetry = await this.safely('whatsapp-retry', () => this.whatsappRetry.sweep());

    // 2. Daily alerts + reminders at 09:00 IST. This is the one that sends to
    //    customers, hence a fixed business-hours slot rather than "whenever".
    if (hour >= CronService.DAILY_ALERTS_HOUR && (await this.claim('daily-alerts', today))) {
      result.dailyAlerts = await this.safely('daily-alerts', () =>
        this.notifications.runAllAlerts(),
      );
    } else {
      result.dailyAlerts = 'not due';
    }

    // 3. Expired shared-file cleanup, daily at 03:00 IST. Runs daily rather
    //    than weekly on purpose: the share link is a public R2 URL with no
    //    server-side expiry check, so a file stays downloadable until this
    //    deletes it. A weekly sweep would leave "90-day" links live for up to
    //    97 days.
    if (hour >= CronService.CLEANUP_HOUR && (await this.claim('shared-files-cleanup', today))) {
      result.sharedFilesCleanup = await this.safely('shared-files-cleanup', () =>
        this.sharedFiles.cleanupExpired(),
      );
    } else {
      result.sharedFilesCleanup = 'not due';
    }

    this.logger.log(`tick @${hour}:00 IST — ${JSON.stringify(result)}`);
    return result;
  }

  // Run a task without letting its failure abort the rest of the tick — a
  // Razorpay outage must not stop the shared-file cleanup, and vice versa.
  private async safely<T>(name: string, fn: () => Promise<T>): Promise<unknown> {
    try {
      return (await fn()) ?? 'ok';
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`cron task "${name}" failed: ${message}`);
      return { error: message };
    }
  }

  private dayKey(d: Date): string {
    // Local (IST) calendar day, not UTC — a 09:00 IST run must map to the
    // Indian date, otherwise anything before 05:30 IST would claim "yesterday".
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Atomically claim a task for a given day. Returns true exactly once per
  // (task, day) across every instance and every concurrent tick.
  //
  // A read-then-write would race: two ticks could both see "not run today" and
  // both proceed. Instead the UPDATE itself carries the condition, so Postgres
  // decides the winner — the loser gets 0 rows affected and skips.
  private async claim(task: string, dayKey: string): Promise<boolean> {
    const key = `cron:${task}`;
    // Ensure the row exists. `create` races are expected and harmless — the
    // unique constraint on `key` means only one wins, and either way a row is
    // present before the conditional update below.
    try {
      await this.prisma.globalSetting.create({
        data: { key, value: { lastRunDay: null } },
      });
    } catch {
      /* already exists */
    }

    const affected = await this.prisma.$executeRaw`
      UPDATE "GlobalSetting"
         SET value = ${JSON.stringify({ lastRunDay: dayKey })}::jsonb,
             "updatedAt" = NOW()
       WHERE key = ${key}
         AND (value->>'lastRunDay') IS DISTINCT FROM ${dayKey}
    `;
    return affected > 0;
  }
}
