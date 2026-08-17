import { Module } from '@nestjs/common'
import { RemindersController } from './reminders.controller'
import { RemindersService } from './reminders.service'
import { PrismaModule } from '../prisma/prisma.module'
import { NotificationsModule } from '../notifications/notifications.module'

@Module({
  // NotificationsModule for the create-time reminder sweep (see
  // RemindersService.create). No cycle: NotificationsModule doesn't import this.
  imports: [PrismaModule, NotificationsModule],
  controllers: [RemindersController],
  providers: [RemindersService],
})
export class RemindersModule {}
