import { IsString, IsNotEmpty } from 'class-validator';

// Body for enabling courier tracking on an invoice (the "Courier" toggle).
// Only the invoice id is needed — the service snapshots customer + order
// details from the invoice itself.
export class CreateDeliveryDto {
  @IsString()
  @IsNotEmpty()
  invoiceId: string;
}
