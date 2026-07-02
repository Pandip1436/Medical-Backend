import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ReminderContactStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import {
  customerSaleReminderTemplate,
  type CustomerSaleReminderVars,
} from '../whatsapp/templates';
import {
  NOTIFICATION_CREATED,
  type NotificationCreatedPayload,
} from './notification-events';

// Fires AFTER NotificationsService.generateReminderAlerts() creates a
// SYSTEM notification for a due CustomerReminder. The notification's
// entityId is the reminder.id. We:
//   1. confirm a real CustomerReminder exists for that id (skip otherwise
//      — SYSTEM is used for several things, only some are reminders),
//   2. load the customer + branch,
//   3. check opt-in + phone,
//   4. confirm no WHATSAPP_AUTO_SENT ReminderContact already exists for
//      this reminder in the current month (additional layer on top of
//      the notification scheduler's month+year dedup),
//   5. send the customer_sale_reminder template,
//   6. log a ReminderContact row with status=WHATSAPP_AUTO_SENT so staff
//      see in the RemindersPage that the customer has already been pinged.
//
// Feature flag: WHATSAPP_SALE_REMINDER_ENABLED (default off).
@Injectable()
export class ReminderDueNotificationListener {
  private readonly logger = new Logger(ReminderDueNotificationListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  @OnEvent(NOTIFICATION_CREATED, { async: true })
  async handle(payload: NotificationCreatedPayload) {
    if (payload.type !== 'SYSTEM') return;
    if (process.env.WHATSAPP_SALE_REMINDER_ENABLED !== 'true') {
      this.logger.debug(
        `sale-reminder auto-send disabled, skipping notification ${payload.notificationId}`,
      );
      return;
    }
    if (!payload.entityId) return;

    // SYSTEM notifications cover several use-cases (auto opt-out alerts,
    // reminder-due alerts, etc.). Only proceed when entityId points to an
    // actual CustomerReminder row — otherwise this is some other SYSTEM
    // event we don't care about.
    const reminder = await this.prisma.customerReminder.findUnique({
      where: { id: payload.entityId },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            whatsappNumber: true,
            whatsappOptIn: true,
          },
        },
        branch: { select: { name: true } },
        products: { select: { productName: true } },
      },
    });
    if (!reminder) {
      // Not a reminder-driven SYSTEM notification — ignore quietly.
      return;
    }
    if (!reminder.isActive) {
      // Belt-and-braces: generateReminderAlerts() already filters to active
      // reminders, but a stop could've landed between alert generation and
      // this listener running (e.g. a queued/retried event).
      this.logger.debug(`reminder ${reminder.id} is stopped — skip send`);
      return;
    }
    if (!reminder.customer) {
      this.logger.warn(`reminder ${reminder.id} has no customer (orphaned)`);
      return;
    }
    if (!reminder.customer.whatsappOptIn) {
      this.logger.log(`customer ${reminder.customer.id} opted out of WhatsApp`);
      return;
    }
    const phone = reminder.customer.whatsappNumber ?? reminder.customer.phone;
    if (!phone) {
      this.logger.log(`customer ${reminder.customer.id} has no phone for WhatsApp`);
      return;
    }

    // Belt-and-braces month dedup: the notification scheduler already
    // suppresses by [reminderId:][month:][year:] markers in the message
    // text, but if the listener was disabled for a previous run and now
    // we replay a backlog of monthly notifications, we should still only
    // ping each customer once per month.
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const alreadySentThisMonth = await this.prisma.reminderContact.findFirst({
      where: {
        reminderId: reminder.id,
        status: ReminderContactStatus.WHATSAPP_AUTO_SENT,
        contactedAt: { gte: monthStart },
      },
      select: { id: true },
    });
    if (alreadySentThisMonth) {
      this.logger.debug(
        `reminder ${reminder.id} already auto-sent this month — skip`,
      );
      return;
    }

    const customerFirstName = (reminder.customer.name ?? 'Customer').trim().split(/\s+/)[0];
    // Name the specific medicines when the reminder has linked products;
    // otherwise fall back to the reminder's free-text title (e.g. the
    // generic "Payment follow-up" reminders created by bulk-create have no
    // products). Reuses the existing approved template's 3rd text slot
    // rather than requiring a new Meta-approved template variant.
    const productList = reminder.products.map((p) => p.productName).join(', ');
    const reminderTitle = productList || reminder.title;
    const vars: CustomerSaleReminderVars = {
      customerFirstName,
      pharmacyName: reminder.branch?.name ?? 'your pharmacy',
      reminderTitle,
    };

    try {
      await this.whatsapp.sendTemplate({
        to: phone,
        template: customerSaleReminderTemplate(vars),
        templateName: 'customer_sale_reminder',
        templateVars: vars,
        bodySnapshot: `Monthly reminder: ${reminderTitle}`,
        relatedEntityType: 'customer_sale_reminder',
        relatedEntityId: reminder.id,
        branchId: reminder.branchId ?? null,
      });

      // Log the auto-send as a ReminderContact so it shows up in the
      // RemindersPage contact log alongside manual calls.
      await this.prisma.reminderContact.create({
        data: {
          reminderId: reminder.id,
          status: ReminderContactStatus.WHATSAPP_AUTO_SENT,
          notes: `Auto-sent WhatsApp template "customer_sale_reminder" to ${phone}.`,
        },
      });
    } catch (e: any) {
      this.logger.error(
        `sale-reminder WhatsApp failed for ${reminder.customer.name}: ${e?.message ?? e}`,
      );
    }
  }
}
