import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { GrnService } from './grn.service';
import { CreateGrnDto } from './dto/create-grn.dto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('grn')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/grn')
export class GrnController {
  constructor(private readonly grnService: GrnService) {}

  @Post()
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Create a new Goods Receipt Note and spawn batches' })
  create(@Body() createGrnDto: CreateGrnDto) {
    return this.grnService.create(createGrnDto);
  }

  @Get()
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'List all GRNs or search' })
  @ApiQuery({ name: 'q', required: false, description: 'Search term for GRN number or supplier' })
  findAll(@Query('q') q?: string) {
    return this.grnService.findAll(q);
  }

  @Get(':id')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Get specific GRN details' })
  findOne(@Param('id') id: string) {
    return this.grnService.findOne(id);
  }
}
