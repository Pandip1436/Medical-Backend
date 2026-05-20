import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { BackupTrigger } from '@prisma/client';
import { BackupService } from './backup.service';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
// Target "2 AM IST" each day. We compute ms-until-next-02:00-IST at boot and
// then schedule a daily run via setInterval. Drift is bounded — if the host
// time drifts more than ~minutes the timestamps in the Backup table tell us.
const TARGET_HOUR_IST = 2;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function msUntilNext2AmIst(now: Date = new Date()): number {
  // Convert now → IST wall clock
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  // Build a target Date for today 02:00 IST
  const target = new Date(
    Date.UTC(
      istNow.getUTCFullYear(),
      istNow.getUTCMonth(),
      istNow.getUTCDate(),
      TARGET_HOUR_IST,
      0,
      0,
      0,
    ),
  );
  let delta = target.getTime() - istNow.getTime();
  if (delta <= 0) delta += ONE_DAY_MS;
  return delta;
}

@Injectable()
export class BackupScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(BackupScheduler.name);
  private bootstrapTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly service: BackupService) {}

  onApplicationBootstrap() {
    const delay = msUntilNext2AmIst();
    const hours = (delay / (60 * 60 * 1000)).toFixed(1);
    this.logger.log(`Next scheduled backup in ${hours}h (targeting ~02:00 IST daily)`);
    // First run lines up with the next 02:00 IST. After that, every 24h.
    this.bootstrapTimer = setTimeout(() => {
      void this.runOnce();
      this.intervalId = setInterval(() => void this.runOnce(), ONE_DAY_MS);
    }, delay);
  }

  onApplicationShutdown() {
    if (this.bootstrapTimer) clearTimeout(this.bootstrapTimer);
    if (this.intervalId) clearInterval(this.intervalId);
    this.bootstrapTimer = null;
    this.intervalId = null;
  }

  private async runOnce(): Promise<void> {
    try {
      const row = await this.service.run(BackupTrigger.SCHEDULED);
      this.logger.log(
        `Scheduled backup ${row.id} completed — ${row.rowCount} rows, ${row.sizeBytes} bytes.`,
      );
    } catch (err) {
      this.logger.error(`Scheduled backup failed: ${(err as Error).message}`);
    }
    try {
      const { deleted } = await this.service.sweepRetention();
      if (deleted > 0) this.logger.log(`Retention sweep removed ${deleted} old backup(s).`);
    } catch (err) {
      this.logger.warn(`Retention sweep failed: ${(err as Error).message}`);
    }
  }
}
