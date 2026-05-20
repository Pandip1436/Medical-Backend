import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PublicPayService } from './public-pay.service';

// PUBLIC ENDPOINT — no JWT guard. Used by the customer-facing /pay/:id
// page (linked from WhatsApp template URL button) to render the payment QR
// + amount + status. Returns a narrow view (see PublicPayView) so we don't
// leak items, doctor info, other invoices, etc. to anyone who guesses an
// invoice id.
//
// Note: invoice ids are cuids (~25 chars) — effectively unguessable. Still,
// the response is intentionally minimal as defence-in-depth.
@ApiTags('public-pay')
@Controller('api/v1/public/pay')
export class PublicPayController {
  constructor(private readonly service: PublicPayService) {}

  @Get(':invoiceId')
  @ApiOperation({ summary: 'Customer-facing pay-page data for an invoice' })
  get(@Param('invoiceId') invoiceId: string) {
    return this.service.getPayView(invoiceId);
  }
}
