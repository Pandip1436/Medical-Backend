import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
const RECEIPT_ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

// Reusable multer config for receipt uploads — memory storage so the service
// can stream the buffer straight to R2 without touching local disk. Cloud
// Run's disk is ephemeral, so any disk-backed pipeline would lose receipts
// after a redeploy.
const receiptInterceptor = FileInterceptor('receipt', {
  storage: memoryStorage(),
  limits: { fileSize: RECEIPT_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!RECEIPT_ACCEPTED_MIME.includes(file.mimetype)) {
      return cb(
        new BadRequestException('Receipt must be JPEG, PNG, WEBP, or PDF'),
        false,
      );
    }
    cb(null, true);
  },
});

@ApiTags('expenses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Create a new expense (optional receipt file)' })
  @ApiConsumes('application/json', 'multipart/form-data')
  @UseInterceptors(receiptInterceptor)
  create(
    @Body() dto: CreateExpenseDto,
    @Request() req: any,
    @Query('branchId') branchId?: string,
    @UploadedFile() receipt?: Express.Multer.File,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    return this.expensesService.create(dto, effectiveBranchId, receipt);
  }

  @Get()
  @Roles('ADMIN', 'ACCOUNTANT', 'PHARMACIST')
  @ApiOperation({ summary: 'Get paginated expenses with optional filters + monthly summary + category breakdown' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'paymentMode', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  findAll(
    @Request() req: any,
    @Query('category') category?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('search') search?: string,
    @Query('paymentMode') paymentMode?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    return this.expensesService.findAll({
      category,
      from,
      to,
      branchId: effectiveBranchId,
      search,
      paymentMode,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':id')
  @Roles('ADMIN', 'ACCOUNTANT', 'PHARMACIST')
  @ApiOperation({ summary: 'Get a single expense' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.expensesService.findOne(id, req.user.branchId);
  }

  @Patch(':id')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Update an expense (optional new receipt file)' })
  @ApiConsumes('application/json', 'multipart/form-data')
  @UseInterceptors(receiptInterceptor)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDto,
    @Request() req: any,
    @UploadedFile() receipt?: Express.Multer.File,
  ) {
    return this.expensesService.update(id, dto, req.user.branchId, receipt);
  }

  @Delete(':id')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Delete an expense' })
  remove(@Param('id') id: string, @Request() req: any) {
    return this.expensesService.remove(id, req.user.branchId);
  }
}
