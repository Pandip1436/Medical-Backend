import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  Query,
  Request,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { PrescriptionsService } from './prescriptions.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'

// In-memory storage so the file buffer can be streamed straight to R2 (cloud
// object storage). Disk storage only persisted on whichever server received
// the upload — so files uploaded locally 404'd in production and vice-versa.
const multerOptions = {
  storage: memoryStorage(),
}

@Controller('api/v1/prescriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PrescriptionsController {
  constructor(private readonly svc: PrescriptionsService) {}

  @Post('upload')
  @Roles('ADMIN', 'PHARMACIST')
  @UseInterceptors(FileInterceptor('file', multerOptions))
  upload(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5 MB
          // skipMagicNumbersValidation lets the regex test the mimetype string
          // directly (image/png, application/pdf, etc.) without magic-byte
          // sniffing — which was rejecting valid PNGs in some browsers.
          new FileTypeValidator({
            fileType: /^(image\/(jpe?g|png|webp)|application\/pdf)$/,
            skipMagicNumbersValidation: true,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body('customerId') customerId: string,
    @Body('doctorName') doctorName: string,
    @Request() req: any,
    @Body('notes') notes?: string,
    @Body('validUntil') validUntil?: string,
    @Body('branchId') bodyBranchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? bodyBranchId
    return this.svc.create(customerId, doctorName, notes, validUntil, file, effectiveBranchId)
  }

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  findByCustomer(
    @Query('customerId') customerId: string,
    @Request() req: any,
    @Query('branchId') branchId?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId
    const skipNum = skip !== undefined ? Number(skip) : undefined
    const takeNum = take !== undefined ? Number(take) : undefined
    return this.svc.findByCustomer(customerId, effectiveBranchId, {
      skip: Number.isFinite(skipNum) ? skipNum : undefined,
      take: Number.isFinite(takeNum) ? takeNum : undefined,
    })
  }

  @Get(':id')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.svc.findOne(id, req.user.branchId)
  }

  @Patch(':id')
  @Roles('ADMIN', 'PHARMACIST')
  update(
    @Param('id') id: string,
    @Request() req: any,
    @Body('doctorName') doctorName?: string,
    @Body('notes') notes?: string,
    @Body('validUntil') validUntil?: string,
  ) {
    return this.svc.update(id, { doctorName, notes, validUntil }, req.user.branchId)
  }

  @Delete(':id')
  @Roles('ADMIN', 'PHARMACIST')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.svc.remove(id, req.user.branchId)
  }
}
