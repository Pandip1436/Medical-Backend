import { Controller, Get, Post, Put, Body, Patch, Param, Delete, UseGuards, Request, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create a new user/staff member' })
  create(@Body() createUserDto: CreateUserDto, @Request() req: any) {
    // Branch assignment is driven by `branchIds` (the allowed set); the service
    // derives the primary role and home branch. `req.user` constrains what a
    // Branch Admin may grant (no Super Admin, only their own branches).
    return this.usersService.create(createUserDto, req.user);
  }

  @Get()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get all users' })
  @ApiQuery({ name: 'branchId', required: false })
  findAll(@Request() req: any, @Query('branchId') branchId?: string) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    return this.usersService.findAll(effectiveBranchId);
  }

  // ── Self-service UI preferences (any authenticated user, no @Roles gate) ──
  // Declared above @Get(':id') so the literal "me" segment isn't captured as an id.
  @Get('me/preferences')
  @ApiOperation({ summary: "Get the current user's UI preferences blob" })
  getMyPreferences(@Request() req: any) {
    return this.usersService.getPreferences(req.user.userId);
  }

  // Reads the raw request body (an open-ended preferences blob) directly so the
  // global ValidationPipe doesn't strip its dynamic keys. Shallow-merged server-side.
  @Put('me/preferences')
  @ApiOperation({ summary: "Shallow-merge into the current user's UI preferences" })
  updateMyPreferences(@Request() req: any) {
    return this.usersService.mergePreferences(req.user.userId, req.body ?? {});
  }

  @Get(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get single user details' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.usersService.findOne(id, req.user.branchId);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update a user' })
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto, @Request() req: any) {
    return this.usersService.update(id, updateUserDto, req.user.branchId, req.user);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Delete a user' })
  remove(@Param('id') id: string, @Request() req: any) {
    return this.usersService.remove(id, req.user.branchId);
  }
}
