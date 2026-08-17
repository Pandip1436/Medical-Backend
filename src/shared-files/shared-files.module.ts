import { Module } from '@nestjs/common'
import { SharedFilesController } from './shared-files.controller'
import { SharedFilesService } from './shared-files.service'
import { SharedFilesScheduler } from './shared-files.scheduler'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [SharedFilesController],
  providers: [SharedFilesService, SharedFilesScheduler],
  // Exported for the cron tick — the in-process scheduler cannot be relied on
  // under Cloud Run's request-scoped CPU (see CronService).
  exports: [SharedFilesService],
})
export class SharedFilesModule {}
