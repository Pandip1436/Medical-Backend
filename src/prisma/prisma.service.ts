import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

// Error codes worth retrying on. Both indicate transient infrastructure
// issues, not application bugs:
//   P1001 — can't reach the database (Neon compute suspended, network blip)
//   P2024 — pool timeout (everything's busy, wait a bit and try again)
const RETRYABLE_PRISMA_CODES = new Set(['P1001', 'P2024']);

const RETRY_DELAYS_MS = [500, 1500, 4000]; // 3 attempts, ~6s total budget

function isRetryable(err: unknown): boolean {
  // Known query-time errors carry a code (P1001 conn refused, P2024 pool timeout)
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    RETRYABLE_PRISMA_CODES.has(err.code)
  ) {
    return true;
  }
  // Initialization errors fire when Prisma can't reach the DB at all (e.g.
  // Neon compute suspended). The errorCode field is sometimes undefined on
  // these — in that case fall back to the message text, since "can't reach"
  // is always transient for us.
  if (err instanceof Prisma.PrismaClientInitializationError) {
    if (
      typeof err.errorCode === 'string' &&
      RETRYABLE_PRISMA_CODES.has(err.errorCode)
    ) {
      return true;
    }
    if (
      /can't reach database|connection.*refused|timed out/i.test(err.message)
    ) {
      return true;
    }
  }
  return false;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // Raise the interactive-transaction limits above Prisma's defaults
    // (maxWait 2s / timeout 5s). Several transactions — invoice creation,
    // GRN posting, purchase returns — do many sequential writes against a
    // remote Neon DB, where round-trip latency makes 5s easy to exceed and
    // trip P2028 ("transaction already closed"). These are ceilings, not
    // delays: fast transactions are unaffected.
    super({
      transactionOptions: {
        maxWait: 10_000, // wait up to 10s to acquire a pooled connection
        timeout: 20_000, // allow a transaction to run up to 20s
      },
    });

    // Auto-retry transient connection failures. Neon (and similar serverless
    // Postgres) suspends compute when idle — the first query after a long
    // pause can fail with P1001 while the compute spins up. Pool exhaustion
    // (P2024) is also transient when bursts of requests arrive together.
    // We retry up to 3 times with backoff, then surface the original error.
    //
    // Using $use (deprecated but still functional in Prisma 5) because it's
    // applied uniformly across every query without the cast gymnastics
    // $extends would require with class inheritance.
    this.$use(async (params, next): Promise<unknown> => {
      for (let attempt = 0; ; attempt++) {
        try {
          return (await next(params)) as unknown;
        } catch (err) {
          if (attempt < RETRY_DELAYS_MS.length && isRetryable(err)) {
            const delay = RETRY_DELAYS_MS[attempt];
            this.logger.warn(
              `Transient DB error on ${params.model ?? 'raw'}.${params.action} ` +
                `(attempt ${attempt + 1}/${RETRY_DELAYS_MS.length + 1}); ` +
                `retrying in ${delay}ms.`,
            );
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          throw err;
        }
      }
    });
  }

  async onModuleInit() {
    // Don't block bootup on a cold database. Neon (and similar serverless
    // Postgres providers) suspend compute when idle — the first connection
    // attempt after a long pause can take 5-15s and may time out before the
    // compute is ready. Prisma will lazy-connect on the first query anyway,
    // so we attempt eager connect, log a warning if it fails, and continue.
    try {
      await this.$connect();
    } catch (err) {
      this.logger.warn(
        `Eager DB connect failed at boot (${(err as Error).message}). ` +
          `Prisma will retry on first query.`,
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
