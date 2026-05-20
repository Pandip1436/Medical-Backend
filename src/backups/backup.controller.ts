import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { BackupService } from './backup.service';
import { BackupTrigger } from '@prisma/client';

@Controller('api/v1/backups')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class BackupController {
  constructor(private readonly service: BackupService) {}

  @Get()
  async list() {
    return this.service.list();
  }

  // Synchronous: blocks for the duration of the backup run (10-30s today).
  // Frontend should show a "Backup in progress…" spinner while the request
  // is in flight.
  @Post()
  async runManual(@Req() req: AuthenticatedRequest) {
    return this.service.run(BackupTrigger.MANUAL, req.user.userId);
  }

  // Returns a short-lived signed R2 URL for downloading the backup file.
  // The frontend opens this URL in a new tab — no streaming through the
  // backend (saves bandwidth + keeps the API lightweight).
  @Get(':id/download')
  async download(@Param('id') id: string) {
    return this.service.getDownloadUrl(id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ ok: true }> {
    await this.service.remove(id);
    return { ok: true };
  }
}
