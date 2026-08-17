import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationsService } from './notifications.service';

// Daily sweep, 09:00 IST. Previously this was `setInterval(24h)` armed at boot,
// which meant the sweep fired 24h after whenever the process last started — so
// on a platform that restarts (deploys, scaling, health checks) the schedule
// drifted to arbitrary times and a reminder created after the last run simply
// never fired that month. A cron pins it to a real clock time instead.
//
// In-process (@nestjs/schedule, already used by WhatsAppRetryService) — no
// external scheduler, no extra infrastructure.
const DAILY_CRON = '0 9 * * *';
const TZ = 'Asia/Kolkata';

// Reminder alerts trigger customer-facing WhatsApp sends, so the boot-time
// catch-up must not fire them at whatever hour a container happens to restart —
// a real reminder went out at 00:01 IST that way. Outside these hours the
// startup pass still generates the in-app alerts and leaves reminders to the
// cron. The cron itself is always allowed: its slot is business hours already.
const BUSINESS_HOURS_START = 8;
const BUSINESS_HOURS_END = 20;

@Injectable()
export class NotificationsScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationsScheduler.name);
  // A sweep can outlast a restart-triggered one running alongside it; without
  // this both would generate the same alerts concurrently.
  private running = false;

  constructor(private readonly service: NotificationsService) {}

  // Catch-up on boot — covers a day missed while the service was down.
  async onApplicationBootstrap() {
    await this.runAll('startup');
  }

  @Cron(DAILY_CRON, { name: 'daily-alerts', timeZone: TZ })
  async daily() {
    await this.runAll('cron');
  }

  private async runAll(trigger: 'startup' | 'cron' | string) {
    if (this.running) {
      this.logger.warn(`[${trigger}] previous sweep still running — skipping`);
      return;
    }
    this.running = true;
    try {
      const hour = new Date().getHours();
      const withinBusinessHours = hour >= BUSINESS_HOURS_START && hour < BUSINESS_HOURS_END;
      const sendReminders = trigger === 'cron' || withinBusinessHours;

      const [lowStock, expiry, paymentDue, supplierDue, reminders] = await Promise.all([
        this.service.generateLowStockAlerts(undefined),
        this.service.generateExpiryAlerts(undefined, 90),
        this.service.generatePaymentDueAlerts(undefined),
        this.service.generateSupplierPaymentDueAlerts(undefined),
        sendReminders
          ? this.service.generateReminderAlerts()
          : Promise.resolve({ created: 0 }),
      ]);
      this.logger.log(
        `[${trigger}] Alerts generated — lowStock: ${lowStock.created}, expiry: ${expiry.created}, paymentDue: ${paymentDue.created}, supplierDue: ${supplierDue.created}, reminders: ${reminders.created}${sendReminders ? '' : ` (reminders deferred to the ${DAILY_CRON} cron — outside ${BUSINESS_HOURS_START}:00-${BUSINESS_HOURS_END}:00 IST)`}`,
      );
    } catch (err) {
      this.logger.error(`[${trigger}] Failed to generate alerts`, err);
    } finally {
      this.running = false;
    }
  }
}
