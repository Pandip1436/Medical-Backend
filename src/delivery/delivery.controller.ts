import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { DeliveryService } from './delivery.service';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { UpdateDeliveryDto } from './dto/update-delivery.dto';
import { AddDeliveryEventDto } from './dto/add-delivery-event.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('delivery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/delivery')
export class DeliveryController {
  constructor(private readonly deliveryService: DeliveryService) {}

  @Post()
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'DELIVERY')
  @ApiOperation({
    summary:
      'Enable courier tracking for an invoice (Courier toggle). Snapshots customer + order details. Idempotent per invoice.',
  })
  create(@Body() dto: CreateDeliveryDto, @Request() req: any) {
    return this.deliveryService.createFromInvoice(
      dto,
      req.user.userId,
      req.user.branchId,
    );
  }

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'DELIVERY')
  @ApiOperation({ summary: 'List / search delivery tracking records' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: [
      'BOOKED',
      'DISPATCHED',
      'IN_TRANSIT',
      'ARRIVED_AT_HUB',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'RETURNED',
    ],
  })
  findAll(
    @Request() req: any,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('courier') courier?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    const skipNum = skip !== undefined ? Number(skip) : undefined;
    const takeNum = take !== undefined ? Number(take) : undefined;
    return this.deliveryService.findAll(q, status, effectiveBranchId, {
      skip: Number.isFinite(skipNum) ? skipNum : undefined,
      take: Number.isFinite(takeNum) ? takeNum : undefined,
      from: from || undefined,
      to: to || undefined,
      courier: courier || undefined,
    });
  }

  @Post('check-all')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'DELIVERY')
  @ApiOperation({
    summary:
      'Bulk-check tracking status for the active shipments matching the given filters (search / status / courier / date). With no filters this covers every active shipment (has a tracking ID, not yet Delivered/Returned). Returns a sync summary.',
  })
  checkAll(
    @Request() req: any,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('courier') courier?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.deliveryService.checkAll(req.user.branchId, {
      q: q || undefined,
      status: status || undefined,
      courier: courier || undefined,
      from: from || undefined,
      to: to || undefined,
    });
  }

  @Get('invoice/:invoiceId')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'DELIVERY')
  @ApiOperation({
    summary:
      'Get the delivery record for an invoice (null if courier tracking is not enabled).',
  })
  findByInvoice(@Param('invoiceId') invoiceId: string, @Request() req: any) {
    return this.deliveryService.findByInvoice(invoiceId, req.user.branchId);
  }

  @Get(':id')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'DELIVERY')
  @ApiOperation({ summary: 'Get a delivery tracking record by ID' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.deliveryService.findOne(id, req.user.branchId);
  }

  @Patch(':id')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'DELIVERY')
  @ApiOperation({
    summary:
      'Update courier details (name, tracking id, dispatch date, status) and OCR metadata.',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryDto,
    @Request() req: any,
  ) {
    return this.deliveryService.update(id, dto, req.user.branchId);
  }

  @Post(':id/events')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'DELIVERY')
  @ApiOperation({
    summary: 'Append a status update to the delivery timeline.',
  })
  addEvent(
    @Param('id') id: string,
    @Body() dto: AddDeliveryEventDto,
    @Request() req: any,
  ) {
    return this.deliveryService.addEvent(id, dto, req.user.branchId);
  }

  @Post(':id/clear-timeline')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'DELIVERY')
  @ApiOperation({
    summary:
      'Clear the delivery timeline and reset the shipment to a fresh Booked state (for re-syncing).',
  })
  clearTimeline(@Param('id') id: string, @Request() req: any) {
    return this.deliveryService.clearTimeline(id, req.user.branchId);
  }

  @Post(':id/check-status')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'DELIVERY')
  @ApiOperation({
    summary:
      'Validate the tracking ID and return the delivery timeline + latest status.',
  })
  checkStatus(@Param('id') id: string, @Request() req: any) {
    return this.deliveryService.checkStatus(id, req.user.branchId);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Delete a delivery tracking record (disable courier).' })
  remove(@Param('id') id: string, @Request() req: any) {
    return this.deliveryService.remove(id, req.user.branchId);
  }
}
