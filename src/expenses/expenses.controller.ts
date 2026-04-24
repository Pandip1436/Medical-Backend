import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Request } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('expenses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Create a new expense' })
  create(@Body() dto: CreateExpenseDto, @Request() req: any, @Query('branchId') branchId?: string) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    return this.expensesService.create(dto, effectiveBranchId);
  }

  @Get()
  @Roles('ADMIN', 'ACCOUNTANT', 'PHARMACIST')
  @ApiOperation({ summary: 'Get all expenses with optional filters' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  findAll(
    @Request() req: any,
    @Query('category') category?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    return this.expensesService.findAll(category, from, to, effectiveBranchId);
  }

  @Get(':id')
  @Roles('ADMIN', 'ACCOUNTANT', 'PHARMACIST')
  @ApiOperation({ summary: 'Get a single expense' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.expensesService.findOne(id, req.user.branchId);
  }

  @Patch(':id')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Update an expense' })
  update(@Param('id') id: string, @Body() dto: UpdateExpenseDto, @Request() req: any) {
    return this.expensesService.update(id, dto, req.user.branchId);
  }

  @Delete(':id')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Delete an expense' })
  remove(@Param('id') id: string, @Request() req: any) {
    return this.expensesService.remove(id, req.user.branchId);
  }
}
