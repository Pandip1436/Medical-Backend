import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { SalespersonsService } from './salespersons.service';
import { UsersService } from '../users/users.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEmail, IsOptional, MinLength } from 'class-validator';

class CreateSalespersonDto {
  @IsString() @IsNotEmpty() name: string;
  @IsEmail() email: string;
  @IsString() @IsNotEmpty() phone: string;
  @IsString() @MinLength(6) password: string;
  @IsString() @IsNotEmpty() branchId: string;
}

class UpdateSalespersonDto {
  @IsString() @IsOptional() name?: string;
  @IsEmail() @IsOptional() email?: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @MinLength(6) @IsOptional() password?: string;
  @IsString() @IsOptional() branchId?: string;
}

@ApiTags('salespersons')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/salespersons')
export class SalespersonsController {
  constructor(
    private readonly salespersonsService: SalespersonsService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'SALESPERSON')
  findAll(@Query('branchId') branchId?: string) {
    return this.salespersonsService.findAll(branchId);
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateSalespersonDto) {
    return this.usersService.create({
      ...dto,
      role: 'SALESPERSON' as any,
    });
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateSalespersonDto, @Request() req: any) {
    return this.usersService.update(id, dto as any, req.user.branchId);
  }

  @Patch(':id/toggle')
  @Roles('ADMIN')
  async toggle(@Param('id') id: string, @Request() req: any) {
    const user = await this.usersService.findOne(id, req.user.branchId);
    return this.usersService.update(id, { isActive: !user.isActive } as any, req.user.branchId);
  }

  @Get('report')
  @Roles('ADMIN', 'ACCOUNTANT')
  getReport(
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.salespersonsService.getReport(branchId, from, to);
  }

  @Get(':id/stats')
  @Roles('ADMIN', 'SALESPERSON')
  getStats(@Param('id') id: string, @Query('branchId') branchId?: string) {
    return this.salespersonsService.getStats(id, branchId);
  }
}
