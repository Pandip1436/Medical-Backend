import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { IndiamartService } from './indiamart.service';

// Admin-only endpoints for managing the IndiaMART Push API integration.
// Generates the webhook URL, shows status + history, and lets admins rotate
// or disconnect the URL. The actual webhook receiver lives in
// IndiamartWebhookController (different file — no auth guards).
@ApiTags('integrations:indiamart')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/integrations/indiamart')
export class IndiamartController {
  constructor(private readonly svc: IndiamartService) {}

  private resolveBranchId(
    req: AuthenticatedRequest,
    qBranchId?: string,
  ): string {
    const branchId = req.user.branchId ?? qBranchId;
    if (!branchId) {
      throw new BadRequestException(
        'branchId is required (no branch on session — pass ?branchId=).',
      );
    }
    return branchId;
  }

  @Post('webhook')
  @Roles('ADMIN')
  @ApiOperation({
    summary:
      'Generate (or fetch) this branch\'s IndiaMART Push API webhook URL',
  })
  async generate(
    @Request() req: AuthenticatedRequest,
    @Query('branchId') qBranchId?: string,
  ) {
    const branchId = this.resolveBranchId(req, qBranchId);
    const result = await this.svc.getOrCreateWebhook(branchId);
    return { ...(await this.svc.getStatus(branchId)), justCreated: result.regenerated === false ? false : true };
  }

  @Post('webhook/rotate')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Rotate the webhook token — invalidates the old URL immediately',
  })
  async rotate(
    @Request() req: AuthenticatedRequest,
    @Query('branchId') qBranchId?: string,
  ) {
    const branchId = this.resolveBranchId(req, qBranchId);
    await this.svc.rotateWebhook(branchId);
    return this.svc.getStatus(branchId);
  }

  @Delete('credential')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Disconnect (deactivate) the IndiaMART webhook for this branch',
  })
  async disconnect(
    @Request() req: AuthenticatedRequest,
    @Query('branchId') qBranchId?: string,
  ) {
    const branchId = this.resolveBranchId(req, qBranchId);
    await this.svc.disconnect(branchId);
    return this.svc.getStatus(branchId);
  }

  @Get('status')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'Connection status + last push metadata' })
  getStatus(
    @Request() req: AuthenticatedRequest,
    @Query('branchId') qBranchId?: string,
  ) {
    const branchId = this.resolveBranchId(req, qBranchId);
    return this.svc.getStatus(branchId);
  }

  @Get('jobs')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'Last N IndiaMART push audit rows' })
  jobs(
    @Request() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('branchId') qBranchId?: string,
  ) {
    const branchId = this.resolveBranchId(req, qBranchId);
    return this.svc.getJobs(branchId, limit ? Number(limit) : undefined);
  }

  @Post('test-push')
  @Roles('ADMIN')
  @ApiOperation({
    summary:
      'Self-test: synthesize a sample IndiaMART payload and push it through the real receiver pipeline',
  })
  testPush(
    @Request() req: AuthenticatedRequest,
    @Query('branchId') qBranchId?: string,
  ) {
    const branchId = this.resolveBranchId(req, qBranchId);
    return this.svc.sendTestPush(branchId);
  }
}
