import { Module } from '@nestjs/common';
import { CreditNotesService } from './credit-notes.service';
import { CreditNotesController } from './credit-notes.controller';

@Module({
  providers: [CreditNotesService],
  controllers: [CreditNotesController],
})
export class CreditNotesModule {}
