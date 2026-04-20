import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: createUserDto.email }
    });
    if (existing) throw new ConflictException('User with this email already exists');

    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);
    
    return this.prisma.user.create({
      data: {
        ...createUserDto,
        password: hashedPassword,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        isActive: true,
        branchId: true,
        branch: { select: { id: true, name: true, code: true } },
        createdAt: true,
        lastLogin: true,
      }
    });
  }

  findAll(branchId?: string) {
    const where: any = {};
    if (branchId) where.branchId = branchId;
    return this.prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        isActive: true,
        branchId: true,
        branch: { select: { id: true, name: true, code: true } },
        lastLogin: true,
      }
    });
  }

  async findOne(id: string, branchId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        isActive: true,
        branchId: true,
        branch: { select: { id: true, name: true, code: true } },
        createdAt: true,
        lastLogin: true,
      }
    });
    if (!user) throw new NotFoundException('User not found');
    if (branchId && user.branchId && user.branchId !== branchId) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async update(id: string, updateUserDto: UpdateUserDto, branchId?: string) {
    await this.findOne(id, branchId);
    
    let updateData: any = { ...updateUserDto };
    
    if (updateUserDto.password) {
      updateData.password = await bcrypt.hash(updateUserDto.password, 10);
    }
    
    return this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        isActive: true,
        branchId: true,
        branch: { select: { id: true, name: true, code: true } },
      }
    });
  }

  async remove(id: string, branchId?: string) {
    await this.findOne(id, branchId);
    return this.prisma.user.delete({
      where: { id },
    });
  }
}
