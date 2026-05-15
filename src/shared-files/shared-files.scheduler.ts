import { Injectable, OnApplicationBootstrap, OnApplicationShutdown, Logger } from '@nestjs/common'
import { SharedFilesService } from './shared-files.service'

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000

// Walks SharedFile rows whose expiresAt has passed, deletes the on-disk
// file, and removes the row. Runs once at boot then every 24 hours.
@Injectable()
export class SharedFilesScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SharedFilesScheduler.name)
  private intervalId: ReturnType<typeof setInterval> | null = null

  constructor(private readonly service: SharedFilesService) {}

  async onApplicationBootstrap() {
    await this.run('startup')
    this.intervalId = setInterval(() => void this.run('scheduled'), TWENTY_FOUR_HOURS)
  }

  onApplicationShutdown() {
    if (this.intervalId) clearInterval(this.intervalId)
  }

  private async run(trigger: string) {
    try {
      const { removed } = await this.service.cleanupExpired()
      if (removed > 0) {
        this.logger.log(`[${trigger}] Removed ${removed} expired shared file(s)`)
      }
    } catch (err) {
      this.logger.error(`[${trigger}] Failed to clean up expired shared files`, err as Error)
    }
  }
}
