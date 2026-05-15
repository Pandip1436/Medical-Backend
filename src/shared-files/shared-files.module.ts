import { Module } from '@nestjs/common'
import { SharedFilesController } from './shared-files.controller'
import { SharedFilesService } from './shared-files.service'
import { SharedFilesScheduler } from './shared-files.scheduler'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [SharedFilesController],
  providers: [SharedFilesService, SharedFilesScheduler],
})
export class SharedFilesModule {}
