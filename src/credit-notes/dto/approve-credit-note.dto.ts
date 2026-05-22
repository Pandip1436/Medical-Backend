import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SettlementMode } from '@prisma/client';

/**
 * Body for `POST /credit-notes/:id/approve`.
 *
 * Both fields are optional:
 *  - `settlementMode` lets the reviewer override the customer's original choice
 *    after inspecting the goods (e.g. "they wanted a refund but accepting the
 *    return as a credit adjustment is cleaner — fewer cash handoffs").
 *  - `reviewNote` records what the inspector found. Optional on approve (a
 *    clean acceptance doesn't always need an explanation); required on reject
 *    (see `reject-credit-note.dto.ts`).
 */
export class ApproveCreditNoteDto {
  @ApiPropertyOptional({
    enum: ['REFUND', 'CREDIT', 'REPLACEMENT'],
    description:
      'Override the settlement method recorded at CN creation. If omitted, ' +
      'the existing settlementMode on the CN is used.',
  })
  @IsOptional()
  @IsEnum(['REFUND', 'CREDIT', 'REPLACEMENT'])
  settlementMode?: SettlementMode;

  @ApiPropertyOptional({
    description: 'Inspection note. Stored on CreditNote.reviewNote.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reviewNote?: string;
}
