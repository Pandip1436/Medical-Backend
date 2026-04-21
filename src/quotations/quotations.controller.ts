import { Controller, Get, Post, Body, Param, Query, Patch, Delete, UseGuards } from '@nestjs/common';
import { QuotationsService } from './quotations.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/quotations')
export class QuotationsController {
  constructor(private readonly quotationsService: QuotationsService) {}

  @Post()
  @Roles('ADMIN', 'PHARMACIST')
  create(@Body() dto: CreateQuotationDto) {
    return this.quotationsService.create(dto);
  }

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  findAll(
    @Query('q') q?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('status') status?: string,
    @Query('amountMin') amountMin?: number,
    @Query('amountMax') amountMax?: number,
  ) {
    return this.quotationsService.findAll({ q, fromDate, toDate, status, amountMin, amountMax });
  }

  @Get('stats')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  getStats() {
    return this.quotationsService.getStats();
  }

  @Get(':id')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.quotationsService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'PHARMACIST')
  update(@Param('id') id: string, @Body() data: any) {
    return this.quotationsService.update(id, data);
  }

  @Patch(':id/status')
  @Roles('ADMIN', 'PHARMACIST')
  updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.quotationsService.updateStatus(id, status);
  }

  @Delete(':id')
  @Roles('ADMIN', 'PHARMACIST')
  remove(@Param('id') id: string) {
    return this.quotationsService.remove(id);
  }
}
