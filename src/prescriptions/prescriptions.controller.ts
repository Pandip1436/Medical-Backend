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
import { diskStorage } from 'multer'
import { extname } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { PrescriptionsService } from './prescriptions.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'

const multerOptions = {
  storage: diskStorage({
    destination: './uploads/prescriptions',
    filename: (_req: any, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
      cb(null, `${uuidv4()}${extname(file.originalname)}`)
    },
  }),
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
