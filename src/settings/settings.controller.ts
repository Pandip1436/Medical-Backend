import { Controller, Get, Put, Post, Patch, Delete, Body, Query, Param, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('api/v1/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('business')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'INVENTORY_MANAGER', 'SALESPERSON')
  async getBusinessProfile(@Query('branchId') branchId: string) {
    return this.settingsService.getBusinessProfile(branchId);
  }

  @Put('business')
  @Roles('ADMIN')
  async updateBusinessProfile(@Query('branchId') branchId: string, @Body() data: any) {
    return this.settingsService.updateBusinessProfile(branchId, data);
  }

  @Get('discounts')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'INVENTORY_MANAGER')
  async getDiscountRules(@Query('branchId') branchId: string) {
    return this.settingsService.getDiscountRules(branchId);
  }

  @Post('discounts')
  @Roles('ADMIN')
  async createDiscountRule(@Query('branchId') branchId: string, @Body() data: any) {
    return this.settingsService.createDiscountRule(branchId, data);
  }

  @Patch('discounts/:id')
  @Roles('ADMIN')
  async updateDiscountRule(@Param('id') id: string, @Body() data: any) {
    return this.settingsService.updateDiscountRule(id, data);
  }

  @Delete('discounts/:id')
  @Roles('ADMIN')
  async deleteDiscountRule(@Param('id') id: string) {
    return this.settingsService.deleteDiscountRule(id);
  }

  @Get(':key')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'INVENTORY_MANAGER', 'SALESPERSON')
  async getSetting(@Param('key') key: string) {
    return this.settingsService.getSetting(key);
  }

  @Put(':key')
  @Roles('ADMIN')
  async updateSetting(@Param('key') key: string, @Body() value: any) {
    return this.settingsService.updateSetting(key, value);
  }
}
