import {
  Body,
  Controller,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { CustomerImportService } from './customer-import.service';
import { ImportCustomersDto, ImportResult } from './dto/import-customers.dto';

// Split into two routes (instead of one with a `?dryRun=1` query) so OpenAPI
// shows the two operations distinctly and so we can lock the commit path
// behind a tighter role list in the future without affecting preview.
@ApiTags('customers-import')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/customers/import')
export class CustomerImportController {
  constructor(private readonly importService: CustomerImportService) {}

  // Branch resolution order mirrors customers.controller:
  //   1. branchId baked into the JWT (single-branch users)
  //   2. ?branchId=… query param — auto-injected by the frontend's axios
  //      interceptor based on the user's active-branch selector. REQUIRED
  //      for admins whose JWT carries no branch.
  //   3. null (truly cross-branch admin path)
  // Without (2), Super Admin imports were silently landing in `branchId = null`
  // and disappearing from the branch-scoped customer list.
  private resolveBranchId(
    req: AuthenticatedRequest,
    queryBranchId?: string,
  ): string | null {
    return req.user.branchId ?? queryBranchId ?? null;
  }

  @Post('preview')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({
    summary:
      'Dry-run a customer + history import. Returns counts, duplicate matches, and per-row errors without writing anything.',
  })
  @ApiQuery({ name: 'branchId', required: false })
  preview(
    @Body() dto: ImportCustomersDto,
    @Request() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
  ): Promise<ImportResult> {
    return this.importService.runImport(
      { ...dto, dryRun: true },
      {
        userId: req.user.userId,
        branchId: this.resolveBranchId(req, branchId),
      },
    );
  }

  @Post('commit')
  @Roles('ADMIN')
  @ApiOperation({
    summary:
      'Commit a customer + history import inside a single transaction. ADMIN only — this writes historical invoices/payments that bypass live billing flow.',
  })
  @ApiQuery({ name: 'branchId', required: false })
  commit(
    @Body() dto: ImportCustomersDto,
    @Request() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
  ): Promise<ImportResult> {
    return this.importService.runImport(
      { ...dto, dryRun: false },
      {
        userId: req.user.userId,
        branchId: this.resolveBranchId(req, branchId),
      },
    );
  }
}
