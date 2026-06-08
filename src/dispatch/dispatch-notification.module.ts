import { Module } from '@nestjs/common';
import { PdfModule } from '../pdf/pdf.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { DispatchNotificationService } from './dispatch-notification.service';

// PrismaService and R2UploadService are provided globally (PrismaModule /
// CommonServicesModule are @Global), so only Pdf + WhatsApp need importing.
@Module({
  imports: [PdfModule, WhatsAppModule],
  providers: [DispatchNotificationService],
  exports: [DispatchNotificationService],
})
export class DispatchNotificationModule {}
