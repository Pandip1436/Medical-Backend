import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { CreditNotesService } from './credit-notes.service';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { ApproveCreditNoteDto } from './dto/approve-credit-note.dto';
import { RejectCreditNoteDto } from './dto/reject-credit-note.dto';
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
  @ApiOperation({
    summary:
      'File a credit note (sales return) — lands in PENDING_REVIEW until an admin approves on the detail page',
  })
  create(@Body() dto: CreateCreditNoteDto, @Request() req: any) {
    return this.creditNotesService.create(
      dto,
      req.user.userId,
      req.user.branchId,
      req.user.isSuperAdmin === true,
    );
  }

  @Post(':id/approve')
  @Roles('ADMIN')
  @ApiOperation({
    summary:
      'Approve a pending credit note. Executes settlement side effects (stock restore, customer-balance adjust if CREDIT, invoice flip to RETURNED if fully returned). Reviewer may override settlementMode.',
  })
  approve(
    @Param('id') id: string,
    @Body() dto: ApproveCreditNoteDto,
    @Request() req: any,
  ) {
    return this.creditNotesService.approve(
      id,
      req.user.userId,
      dto,
      req.user.branchId,
    );
  }

  @Post(':id/reject')
  @Roles('ADMIN')
  @ApiOperation({
    summary:
      'Reject a pending credit note. Records reviewer + reason; does NOT mutate inventory or balances.',
  })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectCreditNoteDto,
    @Request() req: any,
  ) {
    return this.creditNotesService.reject(
      id,
      req.user.userId,
      dto,
      req.user.branchId,
    );
  }

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'List credit notes or search' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['PENDING_REVIEW', 'APPROVED', 'REJECTED'],
  })
  findAll(
    @Request() req: any,
    @Query('q') q?: string,
    @Query('customerId') customerId?: string,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    const skipNum = skip !== undefined ? Number(skip) : undefined;
    const takeNum = take !== undefined ? Number(take) : undefined;
    return this.creditNotesService.findAll(q, customerId, effectiveBranchId, status, {
      from: from || undefined,
      to: to || undefined,
      skip: Number.isFinite(skipNum) ? skipNum : undefined,
      take: Number.isFinite(takeNum) ? takeNum : undefined,
    });
  }

  @Get('invoice/:invoiceId/returned-qty')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({
    summary:
      'Already-returned qty per (productId, batchId) for an invoice (counts APPROVED + PENDING_REVIEW)',
  })
  getReturnedQtyByInvoice(
    @Param('invoiceId') invoiceId: string,
    @Request() req: any,
  ) {
    return this.creditNotesService.getReturnedQtyByInvoice(
      invoiceId,
      req.user.branchId,
    );
  }

  @Get('customer/:customerId/returnable-items')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({
    summary:
      "Every still-returnable line for a customer, flattened across all their invoices (remaining > 0). Each row carries its source invoice + batch. Powers the customer-first returns flow.",
  })
  getReturnableItemsByCustomer(
    @Param('customerId') customerId: string,
    @Request() req: any,
  ) {
    return this.creditNotesService.getReturnableItemsByCustomer(
      customerId,
      req.user.branchId,
    );
  }

  @Get(':id')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Get specific credit note by ID' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.creditNotesService.findOne(id, req.user.branchId);
  }
}
