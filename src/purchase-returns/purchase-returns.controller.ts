import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { PurchaseReturnsService } from './purchase-returns.service';
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('purchase-returns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/purchase-returns')
export class PurchaseReturnsController {
  constructor(private readonly purchaseReturnsService: PurchaseReturnsService) {}

  @Post()
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Create a purchase return / debit note to supplier' })
  create(@Body() dto: CreatePurchaseReturnDto, @Request() req: any) {
    return this.purchaseReturnsService.create(dto, req.user.userId, req.user.branchId, req.user.role);
  }

  @Get()
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'ACCOUNTANT')
  @ApiOperation({ summary: 'List purchase returns or search' })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'q', required: false })
  findAll(@Request() req: any, @Query('q') q?: string, @Query('branchId') branchId?: string) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    return this.purchaseReturnsService.findAll(q, effectiveBranchId);
  }

  @Get(':id')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Get specific purchase return by ID' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.purchaseReturnsService.findOne(id, req.user.branchId);
  }

  @Patch(':id')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Update purchase return status' })
  updateStatus(@Param('id') id: string, @Body('status') status: any, @Request() req: any) {
    return this.purchaseReturnsService.updateStatus(id, status, req.user.branchId);
  }

  @Patch(':id/link-replacement')
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Link a replacement GRN to a REPLACEMENT settlement debit note and mark as SETTLED' })
  linkReplacement(
    @Param('id') id: string,
    @Body('replacementGrnId') replacementGrnId: string,
    @Request() req: any,
  ) {
    return this.purchaseReturnsService.linkReplacementGrn(id, replacementGrnId, req.user.branchId);
  }
}
