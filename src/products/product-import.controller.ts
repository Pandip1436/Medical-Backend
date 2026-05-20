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
import { ProductImportService } from './product-import.service';
import { ImportProductsDto, ImportResult } from './dto/import-products.dto';

@ApiTags('products-import')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/products/import')
export class ProductImportController {
  constructor(private readonly importService: ProductImportService) {}

  // Branch resolution mirrors customers/suppliers-import:
  //   1. JWT branchId (single-branch users)
  //   2. ?branchId=… query param — auto-injected by the frontend axios
  //      interceptor based on the user's active-branch selector.
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
      'Dry-run a product + category import. Returns counts, duplicate matches, defaulted-field warnings, and per-row errors without writing anything.',
  })
  @ApiQuery({ name: 'branchId', required: false })
  preview(
    @Body() dto: ImportProductsDto,
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
      'Commit a product + category import. ADMIN only — this writes catalog rows that the live billing flow depends on.',
  })
  @ApiQuery({ name: 'branchId', required: false })
  commit(
    @Body() dto: ImportProductsDto,
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
