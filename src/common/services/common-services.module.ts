import { Global, Module } from '@nestjs/common';
import { DocumentNumberingService } from './document-numbering.service';
import { R2UploadService } from './r2-upload.service';

@Global()
@Module({
  providers: [DocumentNumberingService, R2UploadService],
  exports: [DocumentNumberingService, R2UploadService],
})
export class CommonServicesModule {}
