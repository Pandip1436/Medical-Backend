import { Injectable, OnApplicationBootstrap, OnApplicationShutdown, Logger } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

@Injectable()
export class NotificationsScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationsScheduler.name);
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly service: NotificationsService) {}

  // Runs once after the app fully boots — catches all existing low stock, expiry, payment due
  async onApplicationBootstrap() {
    await this.runAll('startup');
    // Then repeat every 24 hours
    this.intervalId = setInterval(() => this.runAll('scheduled'), TWENTY_FOUR_HOURS);
  }

  onApplicationShutdown() {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  private async runAll(trigger: string) {
    try {
      const [lowStock, expiry, paymentDue, supplierDue, reminders] = await Promise.all([
        this.service.generateLowStockAlerts(undefined),
        this.service.generateExpiryAlerts(undefined, 90),
        this.service.generatePaymentDueAlerts(undefined),
        this.service.generateSupplierPaymentDueAlerts(undefined),
        this.service.generateReminderAlerts(),
      ]);
      this.logger.log(
        `[${trigger}] Alerts generated — lowStock: ${lowStock.created}, expiry: ${expiry.created}, paymentDue: ${paymentDue.created}, supplierDue: ${supplierDue.created}, reminders: ${reminders.created}`,
      );
    } catch (err) {
      this.logger.error(`[${trigger}] Failed to generate alerts`, err);
    }
  }
}
