import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { WhatsAppSettingsService, type WhatsAppAutomation } from './whatsapp-settings.service';

// Settings → WhatsApp Messages tab. Read is open to any signed-in role (the
// tab is visible read-only), writing is ADMIN only — these toggles control
// real outbound messages to customers and suppliers.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/whatsapp/automation')
export class WhatsAppSettingsController {
  constructor(private readonly settings: WhatsAppSettingsService) {}

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Current on/off state of every automated WhatsApp message' })
  async get() {
    return {
      flags: await this.settings.getAll(),
      // Surfaced so the UI can explain why every toggle reads as off when the
      // master env switch is down, instead of looking broken.
      masterEnabled: process.env.WHATSAPP_AUTO_SEND_ENABLED === 'true',
    };
  }

  @Put()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Enable/disable individual automated WhatsApp messages' })
  async update(@Body() body: Partial<Record<WhatsAppAutomation, boolean>>) {
    return {
      flags: await this.settings.setFlags(body ?? {}),
      masterEnabled: process.env.WHATSAPP_AUTO_SEND_ENABLED === 'true',
    };
  }
}
