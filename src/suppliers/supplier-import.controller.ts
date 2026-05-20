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
import { SupplierImportService } from './supplier-import.service';
import { ImportResult, ImportSuppliersDto } from './dto/import-suppliers.dto';

@ApiTags('suppliers-import')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/suppliers/import')
export class SupplierImportController {
  constructor(private readonly importService: SupplierImportService) {}

  // Branch resolution mirrors customers-import:
  //   1. JWT branchId (single-branch users)
  //   2. ?branchId=… query param — auto-injected by the frontend axios
  //      interceptor based on the user's active-branch selector. REQUIRED
  //      for admins whose JWT carries no branch.
  //   3. null (truly cross-branch admin path)
  private resolveBranchId(
    req: AuthenticatedRequest,
    queryBranchId?: string,
  ): string | null {
    return req.user.branchId ?? queryBranchId ?? null;
  }

  @Post('preview')
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({
    summary:
      'Dry-run a supplier + history import. Returns counts, duplicate matches, and per-row errors without writing anything.',
  })
  @ApiQuery({ name: 'branchId', required: false })
  preview(
    @Body() dto: ImportSuppliersDto,
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
      'Commit a supplier + history import. ADMIN only — this writes historical POs / GRNs / debit notes that bypass live purchase flow.',
  })
  @ApiQuery({ name: 'branchId', required: false })
  commit(
    @Body() dto: ImportSuppliersDto,
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
