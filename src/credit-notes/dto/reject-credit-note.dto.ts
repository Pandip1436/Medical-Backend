import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Body for `POST /credit-notes/:id/reject`.
 *
 * `reviewNote` is required — rejecting a CN means the returned goods didn't
 * match the claimed reason, and the reviewer must record why. The note shows
 * up on the CN detail page and is the audit trail for "this customer's claim
 * was denied because…".
 */
export class RejectCreditNoteDto {
  @ApiProperty({
    description:
      'Required inspection note explaining why the CN is being rejected. ' +
      'Shown to operators on the CN detail page and recorded as the reject reason.',
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reviewNote: string;
}
