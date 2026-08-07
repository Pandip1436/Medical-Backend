import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { PurchaseReturnsService } from './purchase-returns.service';
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto';
import { PurchaseReturnStatus } from '@prisma/client';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('purchase-returns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/purchase-returns')
export class PurchaseReturnsController {
  constructor(
    private readonly purchaseReturnsService: PurchaseReturnsService,
  ) {}

  @Post()
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER')
  @ApiOperation({
    summary: 'Create a purchase return / debit note to supplier',
  })
  create(
    @Body() dto: CreatePurchaseReturnDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.purchaseReturnsService.create(
      dto,
      req.user.userId,
      req.user.branchId ?? undefined,
      req.user.role,
    );
  }

  @Get()
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'PHARMACIST')
  @ApiOperation({ summary: 'List purchase returns or search' })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'q', required: false })
  findAll(
    @Request() req: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
    return this.purchaseReturnsService.findAll(q, effectiveBranchId);
  }

  // Declared before @Get(':id') so "next-number" isn't captured as an id.
  @Get('next-number')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'PHARMACIST')
  @ApiOperation({ summary: 'Preview the next debit-note number (non-consuming)' })
  async nextNumber(@Request() req: AuthenticatedRequest, @Query('branchId') branchId?: string) {
    const effectiveBranchId = req.user.branchId ?? branchId ?? null;
    return { number: await this.purchaseReturnsService.previewNextNumber(effectiveBranchId) };
  }

  @Get(':id')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'PHARMACIST')
  @ApiOperation({ summary: 'Get specific purchase return by ID' })
  findOne(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.purchaseReturnsService.findOne(
      id,
      req.user.branchId ?? undefined,
    );
  }

  @Patch(':id')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'PHARMACIST')
  @ApiOperation({ summary: 'Update purchase return status' })
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: PurchaseReturnStatus,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.purchaseReturnsService.updateStatus(
      id,
      status,
      req.user.branchId ?? undefined,
    );
  }

  @Patch(':id/link-replacement')
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({
    summary:
      'Link a replacement GRN to a REPLACEMENT settlement debit note and mark as SETTLED',
  })
  linkReplacement(
    @Param('id') id: string,
    @Body('replacementGrnId') replacementGrnId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.purchaseReturnsService.linkReplacementGrn(
      id,
      replacementGrnId,
      req.user.branchId ?? undefined,
    );
  }
}
