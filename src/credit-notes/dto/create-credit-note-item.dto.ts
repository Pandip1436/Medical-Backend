import { IsString, IsNotEmpty, IsNumber, Min, IsDateString } from 'class-validator';

export class CreateCreditNoteItemDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsString()
  @IsNotEmpty()
  productName: string;

  // Deliberately allows '' — invoices created through the customer import
  // carry a batchNumber but no batch link (the batch often doesn't exist in
  // this system), and those lines must still be returnable. approve() falls
  // back to resolving the batch by (productId, batchNumber) for the stock
  // restore, so a blank id costs nothing but the direct link.
  @IsString()
  batchId: string;

  @IsString()
  @IsNotEmpty()
  batchNumber: string;

  @IsDateString()
  expiryDate: string;

  @IsNumber()
  @Min(1)
  returnedQty: number;

  @IsNumber()
  @Min(0)
  rate: number;

  @IsNumber()
  @Min(0)
  gstPercent: number;

  @IsNumber()
  @Min(0)
  amount: number;
}
