import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import {
  lowStockSupplierTemplate,
  type LowStockSupplierVars,
} from '../whatsapp/templates';
import {
  NOTIFICATION_CREATED,
  type NotificationCreatedPayload,
} from './notification-events';

// Cooldown stricter than the notification layer's 24h suppression — even if
// the notification re-fires (e.g. stock dropped another 25%), we still
// don't want to spam the supplier daily about the same SKU. Three days is
// enough that any pending order should be processed before we re-poke.
const SUPPLIER_COOLDOWN_DAYS = 3;

// Fires AFTER NotificationsService creates a LOW_STOCK notification. Looks
// up the product → supplier, checks opt-in + cooldown, sends a WhatsApp
// alert via the existing WhatsAppService pipeline.
//
// Feature flag: WHATSAPP_LOW_STOCK_ENABLED (default off).
//
// Failure policy: each step is best-effort. A Meta hiccup or supplier
// without a phone is logged and skipped — never throws. The in-app
// notification stays as the source of truth for staff to act on.
@Injectable()
export class LowStockNotificationListener {
  private readonly logger = new Logger(LowStockNotificationListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  @OnEvent(NOTIFICATION_CREATED, { async: true })
  async handle(payload: NotificationCreatedPayload) {
    if (payload.type !== 'LOW_STOCK') return;
    if (process.env.WHATSAPP_LOW_STOCK_ENABLED !== 'true') {
      this.logger.debug(
        `low-stock auto-send disabled, skipping notification ${payload.notificationId}`,
      );
      return;
    }
    if (!payload.entityId) return;

    const product = await this.prisma.product.findUnique({
      where: { id: payload.entityId },
      select: {
        id: true,
        name: true,
        totalStock: true,
        minStock: true,
        reorderQty: true,
        preferredSupplierId: true,
        branchId: true,
        branch: { select: { name: true } },
      },
    });
    if (!product) {
      this.logger.warn(`product ${payload.entityId} vanished before listener ran`);
      return;
    }

    // Supplier lookup precedence: explicit override on Product first, else
    // the supplier on the most recent Batch for this product (= who actually
    // delivers it). If neither resolves, the in-app notification still
    // shows the alert; staff can wire up the link manually.
    const supplierId =
      product.preferredSupplierId ??
      (
        await this.prisma.batch.findFirst({
          where: { productId: product.id },
          orderBy: { createdAt: 'desc' },
          select: { supplierId: true },
        })
      )?.supplierId ??
      null;
    if (!supplierId) {
      this.logger.debug(`no supplier route for product ${product.id} (${product.name})`);
      return;
    }

    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: {
        id: true,
        name: true,
        contactPerson: true,
        phone: true,
        whatsappNumber: true,
        whatsappOptIn: true,
      },
    });
    if (!supplier) {
      this.logger.warn(`supplier ${supplierId} not found for product ${product.id}`);
      return;
    }
    if (!supplier.whatsappOptIn) {
      this.logger.log(`supplier ${supplier.id} opted out of WhatsApp`);
      return;
    }
    const phone = supplier.whatsappNumber ?? supplier.phone;
    if (!phone) {
      this.logger.log(`supplier ${supplier.id} has no phone for WhatsApp`);
      return;
    }

    // Cooldown — composite key in `relatedEntityId` so we get per-product,
    // per-supplier dedup. Index on (relatedEntityType, relatedEntityId)
    // already exists, so the lookup is cheap.
    const cooldownKey = `${supplier.id}:${product.id}`;
    const cooldownMs = SUPPLIER_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    const recent = await this.prisma.whatsAppMessage.findFirst({
      where: {
        relatedEntityType: 'supplier_low_stock',
        relatedEntityId: cooldownKey,
        status: { in: ['SENT', 'DELIVERED', 'READ'] },
        createdAt: { gt: new Date(Date.now() - cooldownMs) },
      },
      select: { id: true },
    });
    if (recent) {
      this.logger.debug(
        `cooldown skip: supplier ${supplier.id} + product ${product.id} pinged within ${SUPPLIER_COOLDOWN_DAYS}d`,
      );
      return;
    }

    const vars: LowStockSupplierVars = {
      supplierContactName: supplier.contactPerson || supplier.name,
      pharmacyName: product.branch?.name ?? 'the pharmacy',
      productName: product.name,
      currentStock: String(product.totalStock),
      minStock: String(product.minStock),
      reorderQty: String(product.reorderQty > 0 ? product.reorderQty : product.minStock * 2),
    };

    try {
      await this.whatsapp.sendTemplate({
        to: phone,
        template: lowStockSupplierTemplate(vars),
        templateName: 'low_stock_supplier_alert',
        templateVars: vars,
        bodySnapshot: `Low stock: ${product.name} (${product.totalStock}/${product.minStock})`,
        relatedEntityType: 'supplier_low_stock',
        relatedEntityId: cooldownKey,
        branchId: product.branchId,
      });
    } catch (e: any) {
      this.logger.error(
        `low-stock WhatsApp failed for ${product.name} → ${supplier.name}: ${e?.message ?? e}`,
      );
    }
  }
}
