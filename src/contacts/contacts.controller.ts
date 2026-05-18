import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

@ApiTags('contacts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'List/search contacts (paginated)' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'companyId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'INACTIVE'] })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  findAll(
    @Request() req: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('branchId') qBranchId?: string,
    @Query('companyId') companyId?: string,
    @Query('status') status?: 'ACTIVE' | 'INACTIVE',
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.contactsService.findAll({
      q,
      branchId: req.user.branchId ?? qBranchId ?? undefined,
      companyId,
      status,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Get(':id')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  findOne(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.contactsService.findOne(id, req.user.branchId ?? undefined);
  }

  @Post()
  @Roles('ADMIN', 'PHARMACIST', 'SALESPERSON')
  create(
    @Body() dto: CreateContactDto,
    @Request() req: AuthenticatedRequest,
    @Query('branchId') qBranchId?: string,
  ) {
    return this.contactsService.create(dto, {
      branchId: req.user.branchId ?? qBranchId ?? '',
      userId: req.user.userId,
    });
  }

  @Patch(':id')
  @Roles('ADMIN', 'PHARMACIST', 'SALESPERSON')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.contactsService.update(id, dto, req.user.branchId ?? undefined);
  }

  @Delete(':id')
  @Roles('ADMIN', 'PHARMACIST')
  remove(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.contactsService.remove(id, req.user.branchId ?? undefined);
  }
}
