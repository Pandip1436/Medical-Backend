/**
 * Users-only seed.
 *
 * Creates the 2 branches + 7 login users (and nothing else — no products,
 * invoices, suppliers, etc.). Branches are included because 6 of the 7 users
 * are FK-linked to a branch (branchId + branchAccess); only SUPER_ADMIN is
 * branch-less. Credentials mirror prisma/seed.ts.
 *
 * Idempotent: clears existing users + branches first so re-running is safe on
 * a DB that has only this users-only data.
 */

import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function hash(pw: string) { return bcrypt.hash(pw, 10); }

async function main() {
  console.log('🗑️  Clearing existing users + branches...');
  await prisma.user.deleteMany();
  await prisma.branch.deleteMany();

  // ── BRANCHES ────────────────────────────────────────────────────────────
  console.log('🏢 Seeding branches...');
  const hq = await prisma.branch.create({
    data: {
      id: 'BRN-HQ',
      name: 'Hospital Suppliers - HQ (Madurai)',
      code: 'HQ',
      address: '15, Anna Nagar Main Road, Madurai - 625020',
      phone: '04522-450100',
      email: 'hq@hospitalsuppliers.com',
      gstin: '33AABCH1234A1Z5',
      drugLicense: 'TN/MDU/20A/2020/0001',
      isActive: true,
      isDefault: true,
    },
  });
  const br1 = await prisma.branch.create({
    data: {
      id: 'BRN-BR1',
      name: 'Hospital Suppliers - Chennai Branch',
      code: 'BR1',
      address: '88, Mount Road, Chennai - 600002',
      phone: '044-28450200',
      email: 'chennai@hospitalsuppliers.com',
      gstin: '33AABCH1234A2Z4',
      drugLicense: 'TN/CHE/20A/2021/0055',
      isActive: true,
      isDefault: false,
    },
  });

  // ── USERS ───────────────────────────────────────────────────────────────
  console.log('👤 Seeding users...');

  // ADMIN — no branch (sees all)
  await prisma.user.create({
    data: {
      name: 'Super Admin',
      email: 'admin@pbims.com',
      phone: '9000000001',
      password: await hash('admin123'),
      role: Role.SUPER_ADMIN,
      roles: [Role.SUPER_ADMIN],
      isActive: true,
    },
  });

  // HQ staff
  await prisma.user.create({
    data: {
      name: 'Ravi Kumar', email: 'pharmacist@pbims.com', phone: '9000000002',
      password: await hash('pharma123'), role: Role.PHARMACIST, roles: [Role.PHARMACIST],
      isActive: true, branchId: hq.id, branchAccess: { create: [{ branchId: hq.id }] },
    },
  });
  await prisma.user.create({
    data: {
      name: 'Kumar Singh', email: 'inventory@pbims.com', phone: '9000000003',
      password: await hash('stock123'), role: Role.INVENTORY_MANAGER, roles: [Role.INVENTORY_MANAGER],
      isActive: true, branchId: hq.id, branchAccess: { create: [{ branchId: hq.id }] },
    },
  });
  await prisma.user.create({
    data: {
      name: 'Priya Sharma', email: 'accountant@pbims.com', phone: '9000000004',
      password: await hash('account123'), role: Role.ACCOUNTANT, roles: [Role.ACCOUNTANT],
      isActive: true, branchId: hq.id, branchAccess: { create: [{ branchId: hq.id }] },
    },
  });

  // Chennai staff
  await prisma.user.create({
    data: {
      name: 'Santhosh R', email: 'pharmacist.chennai@pbims.com', phone: '9000000005',
      password: await hash('pharma123'), role: Role.PHARMACIST, roles: [Role.PHARMACIST],
      isActive: true, branchId: br1.id, branchAccess: { create: [{ branchId: br1.id }] },
    },
  });
  await prisma.user.create({
    data: {
      name: 'Divya M', email: 'inventory.chennai@pbims.com', phone: '9000000006',
      password: await hash('stock123'), role: Role.INVENTORY_MANAGER, roles: [Role.INVENTORY_MANAGER],
      isActive: true, branchId: br1.id, branchAccess: { create: [{ branchId: br1.id }] },
    },
  });
  await prisma.user.create({
    data: {
      name: 'Anand K', email: 'accountant.chennai@pbims.com', phone: '9000000007',
      password: await hash('account123'), role: Role.ACCOUNTANT, roles: [Role.ACCOUNTANT],
      isActive: true, branchId: br1.id, branchAccess: { create: [{ branchId: br1.id }] },
    },
  });

  console.log('═══════════════════════════════════════════════════════');
  console.log('✅  USERS SEED COMPLETE');
  console.log('  BRANCHES : 2  (HQ Madurai + Chennai)');
  console.log('  USERS    : 7  (1 Admin + 3 HQ + 3 Chennai)');
  console.log('');
  console.log('  admin@pbims.com              / admin123   → All branches');
  console.log('  pharmacist@pbims.com         / pharma123  → HQ only');
  console.log('  inventory@pbims.com          / stock123   → HQ only');
  console.log('  accountant@pbims.com         / account123 → HQ only');
  console.log('  pharmacist.chennai@pbims.com / pharma123  → Chennai only');
  console.log('  inventory.chennai@pbims.com  / stock123   → Chennai only');
  console.log('  accountant.chennai@pbims.com / account123 → Chennai only');
  console.log('═══════════════════════════════════════════════════════');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
