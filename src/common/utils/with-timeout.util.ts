// Bound a promise that has no timeout of its own.
//
// The WhatsApp send flow chains three external calls — Razorpay (payment link),
// Cloudflare R2 (PDF upload) and Meta Graph (the send) — none of which carried a
// transport-level timeout. A stalled socket therefore produced a promise that
// never settled, and InvoiceCreatedListener's in-flight guard keys off promise
// settlement: one stall left that invoice permanently un-sendable for the life
// of the process, reported to the operator as a bland "skipped".
//
// Note this races rather than cancels — the underlying work may still complete
// later (harmless here: every step is idempotent or writes an audit row). What
// matters is that the CALLER always settles, so guards unwind and the operator
// gets a real reason instead of silence.
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    // Never hold the event loop open just for the watchdog.
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

// Read a timeout from env with a sane default, so ops can widen a limit on a
// slow network without a redeploy.
export function timeoutFromEnv(key: string, fallbackMs: number): number {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallbackMs;
}
