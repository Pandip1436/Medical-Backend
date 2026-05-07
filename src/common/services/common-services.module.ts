import { Global, Module } from '@nestjs/common';
import { DocumentNumberingService } from './document-numbering.service';

@Global()
@Module({
  providers: [DocumentNumberingService],
  exports: [DocumentNumberingService],
})
export class CommonServicesModule {}
