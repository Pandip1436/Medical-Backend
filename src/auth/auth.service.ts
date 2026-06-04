import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { Role } from '@prisma/client';
import { isSuperAdmin } from '../common/roles.util';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(loginDto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: loginDto.email },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        branchAccess: { select: { branchId: true } },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials or account is inactive');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    // Full role set drives permissions; `role` stays as the primary (display).
    const roles = user.roles?.length ? user.roles : [user.role];
    const branchIds = user.branchAccess.map((b) => b.branchId);
    const superAdmin = isSuperAdmin(roles);

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      roles,
      branchId: user.branchId ?? null,
      branchIds,
      isSuperAdmin: superAdmin,
    };
    const token = this.jwtService.sign(payload);

    return {
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          roles,
          branchId: user.branchId ?? null,
          branchIds,
          isSuperAdmin: superAdmin,
          branch: user.branch ?? null,
        },
        accessToken: {
          token: token,
          expiresIn: '8h',
        },
      },
    };
  }

  async register(registerDto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: registerDto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    const role = registerDto.role || Role.PHARMACIST;
    const user = await this.prisma.user.create({
      data: {
        name: registerDto.name,
        email: registerDto.email,
        phone: registerDto.phone,
        password: hashedPassword,
        role,
        roles: [role],
      },
    });

    const payload = { sub: user.id, email: user.email, role: user.role };
    const token = this.jwtService.sign(payload);

    return {
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
        accessToken: {
          token: token,
          expiresIn: '8h',
        },
      },
      message: 'Registration successful',
    };
  }

  async validateUser(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, isActive: true, branchId: true },
    });
  }
}
