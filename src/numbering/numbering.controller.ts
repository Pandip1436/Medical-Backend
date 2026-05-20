import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { NumberingService } from './numbering.service';
import {
  ConfigurableDocType,
  DOC_TYPES,
  FY_FORMATS,
  type FyFormatLiteral,
  UpsertNumberingConfigDto,
} from './dto/upsert-config.dto';
import { SetStartFromDto } from './dto/set-start-from.dto';

function assertDocType(docType: string): ConfigurableDocType {
  if (!(DOC_TYPES as readonly string[]).includes(docType)) {
    throw new BadRequestException(
      `docType must be one of: ${DOC_TYPES.join(', ')}. Got: ${docType}`,
    );
  }
  return docType as ConfigurableDocType;
}

@Controller('api/v1/numbering')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NumberingController {
  constructor(private readonly service: NumberingService) {}

  // List configs (one row per supported docType, with defaults merged).
  // All authenticated roles can read; only ADMIN can mutate.
  @Get('configs')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'INVENTORY_MANAGER', 'SALESPERSON')
  async list(@Query('branchId') branchId?: string) {
    return this.service.listConfigs(branchId ?? null);
  }

  @Put('configs/:docType')
  @Roles('ADMIN')
  async upsert(
    @Param('docType') docTypeParam: string,
    @Body() dto: UpsertNumberingConfigDto,
    @Query('branchId') branchId?: string,
  ) {
    const docType = assertDocType(docTypeParam);
    return this.service.upsertConfig(branchId ?? null, docType, dto);
  }

  @Put('configs/:docType/start-from')
  @Roles('ADMIN')
  async setStartFrom(
    @Param('docType') docTypeParam: string,
    @Body() dto: SetStartFromDto,
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
  ) {
    const docType = assertDocType(docTypeParam);
    const ip = (req.ip || (req.headers['x-forwarded-for'] as string) || null) as string | null;
    return this.service.setStartFrom(branchId ?? null, docType, dto.startFrom, req.user.userId, ip);
  }

  // Optional convenience for backend-side preview (frontend renders locally
  // too — keeping this for completeness/parity with the actual renderer).
  @Get('preview')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'INVENTORY_MANAGER', 'SALESPERSON')
  async preview(
    @Query('template') template: string,
    @Query('fyFormat') fyFormat: string,
    @Query('padding', new DefaultValuePipe(5), ParseIntPipe) padding: number,
    @Query('sample', new DefaultValuePipe(1), ParseIntPipe) sample: number,
  ) {
    if (!template) throw new BadRequestException('template query param is required');
    if (!(FY_FORMATS as readonly string[]).includes(fyFormat)) {
      throw new BadRequestException(`fyFormat must be one of ${FY_FORMATS.join(', ')}`);
    }
    return { preview: this.service.preview(template, fyFormat as FyFormatLiteral, padding, sample) };
  }
}
