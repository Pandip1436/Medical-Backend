import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Role, Prisma } from '@prisma/client';
import { primaryRole, isSuperAdmin } from '../common/roles.util';
import * as bcrypt from 'bcrypt';

// The authenticated caller (req.user) performing the write — used to constrain
// what a Branch Admin may grant. Optional so internal/seed callers skip checks.
type Caller = { roles?: string[]; branchIds?: string[]; isSuperAdmin?: boolean };

// Shape returned to the client for every user read/write.
const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  roles: true,
  phone: true,
  isActive: true,
  branchId: true,
  branch: { select: { id: true, name: true, code: true } },
  branchAccess: { select: { branch: { select: { id: true, name: true, code: true } } } },
  createdAt: true,
  lastLogin: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // Flattens branchAccess into a plain `branches` array + `branchIds` for the FE.
  private shape<T extends { branchAccess?: { branch: { id: string; name: string; code: string } }[] }>(user: T) {
    if (!user) return user;
    const branches = (user.branchAccess ?? []).map((a) => a.branch);
    const { branchAccess, ...rest } = user;
    return { ...rest, branches, branchIds: branches.map((b) => b.id) };
  }

  // ── Per-user UI preferences (client-managed JSON blob) ──────────
  // Holds things like table column visibility: { columns: { [tableKey]: string[] } }.
  // The frontend owns the shape; the backend just persists/merges it.

  async getPreferences(userId: string): Promise<Record<string, unknown>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });
    const prefs = user?.preferences;
    return prefs && typeof prefs === 'object' && !Array.isArray(prefs)
      ? (prefs as Record<string, unknown>)
      : {};
  }

  // Shallow-merge the supplied top-level keys into the stored blob so unrelated
  // preference keys (added by future features) are never clobbered.
  async mergePreferences(
    userId: string,
    partial: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const current = await this.getPreferences(userId);
    const next = { ...current, ...(partial ?? {}) };
    await this.prisma.user.update({
      where: { id: userId },
      data: { preferences: next as Prisma.InputJsonValue },
    });
    return next;
  }

  // Resolves the role set + allowed branches from a create/update payload.
  // For SUPER_ADMIN the branch set is forced empty (all-branches). For any
  // non-super role at least one branch is required.
  private resolveRolesAndBranches(roles: Role[] | undefined, role: Role | undefined, branchIds: string[] | undefined) {
    const effectiveRoles = roles?.length ? roles : (role ? [role] : []);
    if (effectiveRoles.length === 0) {
      throw new BadRequestException('At least one role is required');
    }
    const primary = primaryRole(effectiveRoles);
    const superAdmin = isSuperAdmin(effectiveRoles);
    const branches = superAdmin ? [] : (branchIds ?? []);
    if (!superAdmin && branches.length === 0) {
      throw new BadRequestException('Select at least one branch for this user');
    }
    return {
      roles: effectiveRoles,
      role: primary,
      branchIds: branches,
      homeBranchId: superAdmin ? null : (branches[0] ?? null),
    };
  }

  // Privilege guard: a Branch Admin may neither grant the Super Admin role nor
  // assign branches outside the set they themselves manage. Super Admins (and
  // internal callers with no `caller`) are unrestricted.
  private assertAssignable(caller: Caller | undefined, roles: Role[], branchIds: string[]) {
    if (!caller) return;
    const callerIsSuper = caller.isSuperAdmin ?? (caller.roles ?? []).includes('SUPER_ADMIN');
    if (callerIsSuper) return;
    if (roles.includes(Role.SUPER_ADMIN)) {
      throw new ForbiddenException('Only a Super Admin can assign the Super Admin role');
    }
    const allowed = new Set(caller.branchIds ?? []);
    const outside = branchIds.filter((b) => !allowed.has(b));
    if (outside.length > 0) {
      throw new ForbiddenException('You can only assign branches you manage');
    }
  }

  async create(createUserDto: CreateUserDto, caller?: Caller) {
    const existing = await this.prisma.user.findUnique({ where: { email: createUserDto.email } });
    if (existing) throw new ConflictException('User with this email already exists');

    const { roles, role, branchIds, homeBranchId } = this.resolveRolesAndBranches(
      createUserDto.roles, createUserDto.role, createUserDto.branchIds ?? (createUserDto.branchId ? [createUserDto.branchId] : undefined),
    );
    this.assertAssignable(caller, roles, branchIds);
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        name: createUserDto.name,
        email: createUserDto.email,
        phone: createUserDto.phone,
        password: hashedPassword,
        role,
        roles,
        branchId: homeBranchId,
        isActive: createUserDto.isActive ?? true,
        commissionRate: createUserDto.commissionRate,
        branchAccess: { create: branchIds.map((id) => ({ branchId: id })) },
      },
      select: USER_SELECT,
    });
    return this.shape(user);
  }

  async findAll(branchId?: string) {
    // Scope by the allowed-branch join when a branch is active (branch admins),
    // otherwise return everyone (super admin / unscoped).
    const where = branchId ? { branchAccess: { some: { branchId } } } : {};
    const users = await this.prisma.user.findMany({ where, select: USER_SELECT });
    return users.map((u) => this.shape(u));
  }

  async findOne(id: string, branchId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) throw new NotFoundException('User not found');
    if (branchId && !user.branchAccess.some((a) => a.branch.id === branchId)) {
      throw new NotFoundException('User not found');
    }
    return this.shape(user);
  }

  async update(id: string, updateUserDto: UpdateUserDto, branchId?: string, caller?: Caller) {
    const target = await this.findOne(id, branchId);

    // A Branch Admin must not edit a Super Admin (privilege escalation guard).
    const callerIsSuper = caller ? (caller.isSuperAdmin ?? (caller.roles ?? []).includes('SUPER_ADMIN')) : true;
    if (caller && !callerIsSuper && (target.roles ?? []).includes('SUPER_ADMIN')) {
      throw new ForbiddenException('Only a Super Admin can edit a Super Admin');
    }

    const updateData: any = {};
    if (updateUserDto.name !== undefined) updateData.name = updateUserDto.name;
    if (updateUserDto.phone !== undefined) updateData.phone = updateUserDto.phone;
    // Email is editable, but only through this route — which is @Roles('ADMIN'),
    // so a non-admin can't reach it at all. It was previously dropped on the
    // floor here, which is what the UI's "cannot be changed after creation" note
    // described: the field was sent and silently ignored.
    //
    // It's the login identifier and is @unique, so a collision has to be a clean
    // 409 rather than a raw Prisma P2002 leaking out — same contract create()
    // already offers. Trimmed but NOT case-folded: create() doesn't fold either,
    // and quietly rewriting someone's address to lowercase on an unrelated edit
    // would change the credential they type in.
    if (updateUserDto.email !== undefined) {
      const email = updateUserDto.email.trim();
      if (!email) throw new BadRequestException('Email cannot be blank.');
      // Only validate/write when it actually changed, so re-saving a user with
      // their existing address can't fail against their own row.
      if (email !== target.email) {
        const clash = await this.prisma.user.findUnique({
          where: { email },
          select: { id: true },
        });
        if (clash && clash.id !== id) {
          throw new ConflictException('Another user already has this email address.');
        }
        updateData.email = email;
      }
    }
    if (updateUserDto.isActive !== undefined) updateData.isActive = updateUserDto.isActive;
    if (updateUserDto.commissionRate !== undefined) updateData.commissionRate = updateUserDto.commissionRate;
    if (updateUserDto.password) {
      updateData.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    // Only touch roles/branches when the caller actually sent them.
    const sentRoles = updateUserDto.roles !== undefined || updateUserDto.role !== undefined;
    const sentBranches = updateUserDto.branchIds !== undefined || updateUserDto.branchId !== undefined;
    if (sentRoles || sentBranches) {
      const incomingBranchIds = updateUserDto.branchIds ?? (updateUserDto.branchId ? [updateUserDto.branchId] : []);
      const { roles, role, branchIds, homeBranchId } = this.resolveRolesAndBranches(
        updateUserDto.roles, updateUserDto.role, incomingBranchIds,
      );
      this.assertAssignable(caller, roles, branchIds);
      updateData.role = role;
      updateData.roles = roles;
      updateData.branchId = homeBranchId;
      // Replace the allowed-branch set wholesale.
      updateData.branchAccess = {
        deleteMany: {},
        create: branchIds.map((bid) => ({ branchId: bid })),
      };
    }

    const user = await this.prisma.user.update({ where: { id }, data: updateData, select: USER_SELECT });
    return this.shape(user);
  }

  async remove(id: string, branchId?: string) {
    await this.findOne(id, branchId);
    return this.prisma.user.delete({ where: { id } });
  }
}
