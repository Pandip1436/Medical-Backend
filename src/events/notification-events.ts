// Event payloads emitted by NotificationsService and consumed by listeners
// that turn in-app notifications into outbound channels (WhatsApp, email,
// push). Keeping the shape narrow (notification id + type + the entity id
// the notification is about) so listeners re-fetch their own context —
// keeps the contract stable as Notification / Product / Customer evolve.

export const NOTIFICATION_CREATED = 'notification.created' as const;

export type NotificationKind =
  | 'LOW_STOCK'
  | 'EXPIRY'
  | 'PAYMENT_DUE'
  | 'SYSTEM'
  | 'APPROVAL';

export interface NotificationCreatedPayload {
  notificationId: string;
  type: NotificationKind;
  // For LOW_STOCK this is the productId; for PAYMENT_DUE the invoiceId; for
  // EXPIRY the batchId. SYSTEM / APPROVAL have no concrete entity attached.
  entityId: string | null;
  branchId: string | null;
}
