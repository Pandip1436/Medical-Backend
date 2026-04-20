import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Request } from '@nestjs/common';
import { DoctorsService } from './doctors.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('doctors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/doctors')
export class DoctorsController {
  constructor(private readonly doctorsService: DoctorsService) {}

  @Post()
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Create a new doctor' })
  create(
    @Body() dto: CreateDoctorDto,
    @Request() req: any,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    return this.doctorsService.create({ ...dto, branchId: effectiveBranchId });
  }

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT')
  @ApiOperation({ summary: 'List all active doctors for a branch' })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  findAll(
    @Request() req: any,
    @Query('branchId') branchId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    return this.doctorsService.findAll(effectiveBranchId, includeInactive === 'true');
  }

  @Get(':id')
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Get a single doctor' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.doctorsService.findOne(id, req.user.branchId);
  }

  @Patch(':id')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Update a doctor' })
  update(@Param('id') id: string, @Body() dto: UpdateDoctorDto, @Request() req: any) {
    return this.doctorsService.update(id, dto, req.user.branchId);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Deactivate a doctor (soft delete)' })
  remove(@Param('id') id: string, @Request() req: any) {
    return this.doctorsService.remove(id, req.user.branchId);
  }
}
