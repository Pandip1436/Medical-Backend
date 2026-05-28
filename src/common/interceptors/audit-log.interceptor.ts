import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

const METHOD_TO_ACTION: Record<string, string> = {
  POST: 'CREATE',
  PUT: 'UPDATE',
  PATCH: 'UPDATE',
  DELETE: 'DELETE',
};

// Workflow sub-action routes (e.g. POST /credit-notes/:id/reject) carry far
// more meaning than their HTTP method. Without this, an approve/reject/submit
// all log as "CREATE" (a POST) — producing duplicate "CREATE" rows for one
// record and a confusing audit trail. When the URL segment after the row id
// matches one of these verbs, it overrides the method-derived action.
const VERB_TO_ACTION: Record<string, string> = {
  approve: 'APPROVE',
  reject: 'REJECT',
  submit: 'SUBMIT',
  cancel: 'CANCEL',
  void: 'VOID',
  finalize: 'FINALIZE',
  convert: 'CONVERT',
  'collect-payment': 'PAYMENT',
  payment: 'PAYMENT',
  'send-whatsapp': 'SEND',
  'payment-link': 'SEND',
  'toggle-active': 'UPDATE',
  toggle: 'UPDATE',
  status: 'UPDATE',
  read: 'UPDATE',
  snooze: 'UPDATE',
  resolve: 'UPDATE',
  'link-replacement': 'UPDATE',
};

// Actions that represent a deliberate workflow step. They always get logged
// even when the scalar before/after diff is empty (the action itself is the
// record). Plain UPDATEs with no field change are suppressed instead.
const WORKFLOW_ACTIONS = new Set([
  'APPROVE', 'REJECT', 'SUBMIT', 'CANCEL', 'VOID', 'FINALIZE', 'CONVERT', 'PAYMENT', 'SEND',
]);

const SKIP_PATH_FRAGMENTS = ['/auth/login', '/auth/register', '/audit-logs'];

// Per-module config: the Prisma delegate to snapshot from, and the field that
// best names the record to a human (shown in the audit UI's "Record" column).
// Modules absent here still get logged (falling back to req.body) but without
// a before/after diff or a human label.
interface ModuleConfig {
  model: string;
  label: string;
  // Relations to pull into the snapshot so line-item edits are diffable.
  // Document modules store their lines under an `items` relation; a change
  // to a batch number / qty inside items must be detected, otherwise the
  // edit looks like a no-op and gets suppressed.
  include?: Record<string, boolean>;
}
const ITEMS = { items: true };
const MODULE_CONFIG: Record<string, ModuleConfig> = {
  customers: { model: 'customer', label: 'name' },
  products: { model: 'product', label: 'name' },
  suppliers: { model: 'supplier', label: 'name' },
  categories: { model: 'category', label: 'name' },
  branches: { model: 'branch', label: 'name' },
  users: { model: 'user', label: 'name' },
  expenses: { model: 'expense', label: 'description' },
  quotations: { model: 'quotation', label: 'quotationNumber', include: ITEMS },
  'credit-notes': { model: 'creditNote', label: 'creditNoteNo', include: ITEMS },
  'purchase-orders': { model: 'purchaseOrder', label: 'poNumber', include: ITEMS },
  'purchase-returns': { model: 'purchaseReturn', label: 'debitNoteNo', include: ITEMS },
  grn: { model: 'gRN', label: 'grnNumber', include: ITEMS },
  billing: { model: 'invoice', label: 'invoiceNumber', include: ITEMS },
};

// Scalar keys that are noise in a diff — primary keys, audit/system timestamps,
// tenant scoping, and secrets. Excluded from changed-field detection so an
// edit shows only the fields the user actually touched.
const DIFF_IGNORE_KEYS = new Set([
  'id', 'createdAt', 'updatedAt', 'deletedAt', 'branchId', 'companyId', 'isDeleted',
  'password', 'passwordHash', 'hashedPassword', 'token', 'refreshToken', 'resetToken', 'otp',
]);

// Plain JSON snapshot — flattens Prisma Date/Decimal into serializable values
// and drops relation objects (findUnique without `include` returns scalars
// only, but guard anyway).
function toPlain(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const req = context.switchToHttp().getRequest();
    const method: string = req.method;
    let action = METHOD_TO_ACTION[method];

    if (!action) return next.handle();
    if (SKIP_PATH_FRAGMENTS.some((f) => req.url?.includes(f))) return next.handle();

    const segments = (req.url || '').split('?')[0].split('/').filter(Boolean);
    const apiIdx = segments.indexOf('api');
    const moduleSegment = segments[apiIdx + 2] || segments[segments.length - 1] || 'unknown';
    const idCandidate = segments[apiIdx + 3];

    // Override the method-derived action when the URL ends in a known
    // workflow verb (e.g. /credit-notes/:id/reject → REJECT).
    const trailingVerb = segments[apiIdx + 4];
    if (trailingVerb && VERB_TO_ACTION[trailingVerb]) {
      action = VERB_TO_ACTION[trailingVerb];
    }

    const config = MODULE_CONFIG[moduleSegment];
    const delegate = config ? (this.prisma as any)[config.model] : undefined;
    const canSnapshot = !!delegate?.findUnique && !!idCandidate;
    const isUpdateLike = action === 'UPDATE' || WORKFLOW_ACTIONS.has(action);

    // Capture the pre-mutation snapshot BEFORE the handler runs (UPDATE /
    // workflow / DELETE on a configured model). Best-effort — a fetch failure
    // never blocks the request.
    let oldSnapshot: Record<string, unknown> | null = null;
    if (canSnapshot && (isUpdateLike || action === 'DELETE')) {
      try {
        oldSnapshot = toPlain(
          await delegate.findUnique({ where: { id: idCandidate }, include: config?.include }),
        );
      } catch {
        /* ignore — snapshot is best-effort */
      }
    }

    return next.handle().pipe(
      tap(async (response) => {
        const userId = req.user?.userId;
        if (!userId) return;

        const entityId =
          (response && typeof response === 'object' && (response.id ?? null)) || idCandidate || null;
        const responseObj =
          response && typeof response === 'object' && !Array.isArray(response)
            ? (response as Record<string, unknown>)
            : null;

        // Resolve oldValue / newValue / entityLabel per action type.
        let oldValue: unknown = undefined;
        let newValue: unknown = undefined;
        let entityLabel: string | null = null;

        try {
          if (action === 'CREATE') {
            // Store the created entity (keeps nested item arrays — "what was
            // created" is useful and the UI summarizes them). Prefer the
            // response entity; fall back to the request body.
            newValue = responseObj ?? req.body ?? undefined;
            entityLabel = pickLabel(responseObj, req.body, config);
          } else if (action === 'DELETE') {
            oldValue = oldSnapshot ?? undefined;
            newValue = undefined;
            entityLabel = pickLabel(oldSnapshot, null, config);
          } else if (isUpdateLike) {
            // Re-read the post-mutation scalar snapshot and diff against the
            // before-snapshot. Store only the fields that actually changed.
            let newSnapshot: Record<string, unknown> | null = null;
            if (canSnapshot) {
              try {
                newSnapshot = toPlain(
                  await delegate.findUnique({ where: { id: idCandidate }, include: config?.include }),
                );
              } catch {
                /* ignore */
              }
            }
            const changed = diffFields(oldSnapshot, newSnapshot);

            // No-op plain UPDATE → don't write a row at all. Workflow actions
            // always log (the action is the point), even with no field delta.
            if (changed.length === 0 && !WORKFLOW_ACTIONS.has(action)) return;

            if (changed.length > 0 && oldSnapshot && newSnapshot) {
              oldValue = pick(oldSnapshot, changed);
              newValue = pick(newSnapshot, changed);
            }
            // Workflow actions: surface the reason/note from the request body
            // even when no scalar field changed (e.g. a SEND with no status flip).
            if (WORKFLOW_ACTIONS.has(action)) {
              const reason = pickReason(req.body);
              if (reason) {
                newValue = { ...(newValue as Record<string, unknown> | undefined), ...reason };
              }
            }
            entityLabel = pickLabel(newSnapshot, oldSnapshot, config);
            // Unconfigured module (no snapshot possible): fall back to body.
            if (!canSnapshot) newValue = req.body ?? undefined;
          }

          await this.prisma.auditLog.create({
            data: {
              userId,
              module: moduleSegment,
              action,
              entity: moduleSegment,
              entityId,
              entityLabel,
              oldValue: oldValue === undefined ? undefined : (oldValue as any),
              newValue: newValue === undefined ? undefined : (newValue as any),
              ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
            },
          });
        } catch {
          // Don't break the request if audit logging fails
        }
      }),
    );
  }
}

// Keys whose value differs between two snapshots. Scalars are compared
// directly. Array relations (line items) are compared after normalizing each
// element — stripping volatile keys (ids, timestamps) — so that an edit which
// regenerates item rows with new ids but identical data reads as "no change",
// while a real change (e.g. a batch number) is detected. Non-array nested
// objects are ignored.
function diffFields(
  oldObj: Record<string, unknown> | null,
  newObj: Record<string, unknown> | null,
): string[] {
  if (!oldObj || !newObj) return [];
  const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
  const changed: string[] = [];
  for (const k of keys) {
    if (DIFF_IGNORE_KEYS.has(k)) continue;
    const a = oldObj[k];
    const b = newObj[k];
    if (Array.isArray(a) || Array.isArray(b)) {
      if (JSON.stringify(normalizeItems(a)) !== JSON.stringify(normalizeItems(b))) changed.push(k);
      continue;
    }
    // Skip non-array nested objects (relations we didn't explicitly diff).
    if (isComplex(a) || isComplex(b)) continue;
    if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(k);
  }
  return changed;
}

function isComplex(v: unknown): boolean {
  return v !== null && typeof v === 'object';
}

// Strip volatile/opaque keys from each item so re-saved line items (which may
// get fresh ids) compare equal unless their meaningful fields actually changed.
function normalizeItems(arr: unknown): unknown[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((el) => {
    if (!el || typeof el !== 'object') return el;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(el as Record<string, unknown>)) {
      if (DIFF_IGNORE_KEYS.has(k)) continue;
      if (k === 'id' || k.endsWith('Id')) continue;
      out[k] = v;
    }
    return out;
  });
}

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

function pickLabel(
  primary: Record<string, unknown> | null | undefined,
  fallback: Record<string, unknown> | null | undefined,
  config: ModuleConfig | undefined,
): string | null {
  if (!config) return null;
  for (const src of [primary, fallback]) {
    const v = src?.[config.label];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return null;
}

// Extract a human reason/note from a workflow request body so it shows in the
// audit entry (e.g. a credit-note rejection reason).
function pickReason(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ['reason', 'reviewNote', 'note', 'remarks', 'status']) {
    const v = b[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return Object.keys(out).length ? out : null;
}
