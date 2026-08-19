// How often the alert generators are allowed to nag about the same thing.
//
// Previously these were env-var constants, so tuning them meant a redeploy.
// They now live in the GlobalSetting row keyed CADENCE_SETTING_KEY, edited from
// Settings → Notifications; the env vars remain the DEFAULTS, so an install
// that never opens that screen behaves exactly as before.
//
// Every value is clamped on read: the setting is a free-form JSON blob written
// through the generic PUT /settings/:key endpoint, so a bad/partial payload
// must degrade to the default rather than break alert generation (a 0 for
// reAlertDays would otherwise re-fire an alert on every sweep).

export const CADENCE_SETTING_KEY = 'notifications';

// One rule for every alert type: keep asking, on a fixed interval, until the
// thing is dealt with.
//
// `reAlertDays` is measured from the moment an alert is OPENED, not from when
// it was created. An alert nobody has read is still sitting in the folder, so
// repeating it adds a duplicate row and no information — that's the pile-up
// this screen exists to prevent. Once you've seen it and the invoice still
// isn't paid (or the stock still isn't fixed), the next one comes after
// `reAlertDays`, and so on, with no cap. Alerts end when the underlying problem
// does — payment recorded, batch written off, stock replenished — or when
// somebody marks the alert Resolved.
export interface NotificationCadence {
  /** Money customers owe us — alerts on unpaid/partial invoices. */
  customerDue: {
    /** Start reminding this many days before the invoice due date. */
    beforeDays: number;
    /** Days before asking again, once an alert has been opened. */
    reAlertDays: number;
  };
  /** Money we owe suppliers — alerts on unpaid/partial purchase entries. */
  supplierDue: {
    beforeDays: number;
    reAlertDays: number;
  };
  /** Expiry + low-stock alerts. */
  stock: {
    reAlertDays: number;
    /**
     * Stop chasing a batch this many days after its expiry date. Guards against
     * a long tail of ancient expired rows (stock written off outside the system,
     * bad import data) alerting forever. Raise it if expired stock legitimately
     * sits for longer than this before being written off.
     */
    expiredGraceDays: number;
  };
}

const num = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(v)));

// Env-var defaults — the values these knobs had before they were editable.
function defaults(): NotificationCadence {
  const reAlertDays = num(process.env.NOTIFICATION_READ_DAYS, 3);
  return {
    customerDue: {
      beforeDays: num(process.env.CUSTOMER_PAYMENT_DUE_BEFORE_DAYS, 3),
      reAlertDays,
    },
    // Supplier dues have always started ON the due date (0 days of lead time);
    // the knob now allows a lead time without changing that default.
    supplierDue: { beforeDays: 0, reAlertDays },
    stock: {
      reAlertDays,
      // 30 days is what generateExpiryAlerts has always used as its lower
      // bound. Kept as the default deliberately: raising it makes every batch
      // that expired within the new window start alerting on the next sweep,
      // which on an install with a backlog of old expired rows is a flood. It's
      // a knob now so that's a decision made with the data in front of you.
      expiredGraceDays: 30,
    },
  };
}

/** Merge a stored (possibly partial or malformed) setting over the defaults. */
export function resolveCadence(stored: unknown): NotificationCadence {
  const d = defaults();
  const s = (stored ?? {}) as Record<string, any>;
  const cust = (s.customerDue ?? {}) as Record<string, unknown>;
  const supp = (s.supplierDue ?? {}) as Record<string, unknown>;
  const stock = (s.stock ?? {}) as Record<string, unknown>;
  return {
    customerDue: {
      beforeDays: clamp(num(cust.beforeDays, d.customerDue.beforeDays), 0, 90),
      reAlertDays: clamp(num(cust.reAlertDays, d.customerDue.reAlertDays), 1, 90),
    },
    supplierDue: {
      beforeDays: clamp(num(supp.beforeDays, d.supplierDue.beforeDays), 0, 90),
      reAlertDays: clamp(num(supp.reAlertDays, d.supplierDue.reAlertDays), 1, 90),
    },
    stock: {
      reAlertDays: clamp(num(stock.reAlertDays, d.stock.reAlertDays), 1, 90),
      expiredGraceDays: clamp(num(stock.expiredGraceDays, d.stock.expiredGraceDays), 1, 3650),
    },
  };
}

/** The defaults, for the Settings screen to show as the reset target. */
export const cadenceDefaults = (): NotificationCadence => resolveCadence(null);
