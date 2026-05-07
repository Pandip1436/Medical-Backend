import { Controller, Get, Post, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { CreditNotesService } from './credit-notes.service';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('credit-notes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/credit-notes')
export class CreditNotesController {
  constructor(private readonly creditNotesService: CreditNotesService) {}

  @Post()
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Create a credit note (sales return) for an invoice' })
  create(@Body() dto: CreateCreditNoteDto, @Request() req: any) {
    return this.creditNotesService.create(dto, req.user.userId, req.user.branchId, req.user.role);
  }

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'List credit notes or search' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'customerId', required: false })
  findAll(@Request() req: any, @Query('q') q?: string, @Query('customerId') customerId?: string, @Query('branchId') branchId?: string) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    return this.creditNotesService.findAll(q, customerId, effectiveBranchId);
  }

  @Get('invoice/:invoiceId/returned-qty')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Already-returned qty per (productId, batchId) for an invoice (includes pending approvals)' })
  getReturnedQtyByInvoice(@Param('invoiceId') invoiceId: string, @Request() req: any) {
    return this.creditNotesService.getReturnedQtyByInvoice(invoiceId, req.user.branchId);
  }

  @Get(':id')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Get specific credit note by ID' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.creditNotesService.findOne(id, req.user.branchId);
  }
}
