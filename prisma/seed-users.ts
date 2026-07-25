/**
 * Users-only seed — upserts all 11 users (+ 2 branches they reference).
 *
 * Idempotent: uses upsert-by-email, so re-running is safe on an existing DB.
 * Passwords are inserted as pre-hashed bcrypt strings (no re-hashing needed).
 *
 * Run:  npx ts-node prisma/seed-users.ts
 */

import { PrismaClient, Role } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

const prisma = new PrismaClient();

// ── Users data (from production dump) ─────────────────────────────────────────
const users = [
  {
    id: 'cmqosikgy0000e3ezz8vea04g',
    name: 'Super Admin',
    email: 'admin@pbims.com',
    phone: '9000000001',
    password: '$2b$10$9x1dh1WEi3A4PaIHjDYwq.6oCju0Z8xcQNpUwnyDf2B.hDJvU9gpa',
    role: Role.SUPER_ADMIN,
    roles: [Role.SUPER_ADMIN],
    isActive: true,
    lastLogin: new Date('2026-07-02T07:36:37.911Z'),
    createdAt: new Date('2026-06-22T05:43:54.658Z'),
    branchId: null as string | null,
    commissionRate: new Decimal('0'),
    preferences: {
      columns: {
        'customers.card': ['phone', 'outstanding', 'pending', 'type', 'source', 'status'],
        'customers.list': ['name', 'phone', 'totalAmount', 'paidAmount', 'outstanding', 'type', 'source', 'pending'],
        'billing.sales.card': ['customerName', 'date', 'phone', 'total', 'status', 'balance'],
        'purchase.orders.card': ['total', 'date', 'status', 'items'],
        'purchase.grnList.card': ['supplier', 'date', 'value', 'status', 'issues', 'source'],
        'billing.quotations.card': ['date', 'status', 'items', 'phone', 'total'],
        'inventory.products.card': ['name', 'stock', 'mrp', 'generic'],
        'purchase.suppliers.card': ['outstanding', 'phone', 'gstin'],
        'billing.creditNotes.card': ['date', 'phone', 'amount', 'status'],
        'purchase.debitNotes.card': ['amount', 'date', 'phone', 'status', 'type'],
      },
      filters: {
        'billing.sales': {
          dateTo: '', period: 'all', status: 'all', dateFrom: '', statusTab: 'all',
          cardFilter: 'all', paymentMode: 'all', salespersonId: 'all', splitShowStats: false,
        },
        'customers.list': {
          to: '', from: '', type: 'all', gstin: 'all', month: 'all', payTab: 'all',
          source: 'all', status: 'all', outstanding: 'has', splitShowStats: false,
        },
        'purchase.orders': { period: 'all', statusTab: 'all', splitShowStats: false },
        'purchase.grnList': { payTab: 'all', period: 'all', splitShowStats: false },
        'billing.quotations': {
          dateTo: '', period: 'all', status: 'all', customer: 'all', dateFrom: '',
          statusTab: 'all', customerName: '', splitShowStats: false,
        },
        'inventory.products': { search: '', category: 'all', stockTab: 'in_stock', splitShowStats: false },
        'purchase.suppliers': { splitShowStats: false },
        'billing.creditNotes': { period: 'all', statusTab: 'PENDING_REVIEW', splitShowStats: false },
        'purchase.debitNotes': { period: 'all', statusTab: 'SETTLED', splitShowStats: false },
      },
      positions: {
        'billing.sales.card': { date: 'right', status: 'left' },
        'billing.quotations.card': { date: 'right', items: 'right', total: 'left' },
      },
    },
  },
  {
    id: 'cmqosiko20002e3ezklzo08wp',
    name: 'Ravi Kumar',
    email: 'pharmacist@pbims.com',
    phone: '9000000002',
    password: '$2b$10$x7bWwUleKzZWT1um3m7WU.Rgu8oixKYw8qrDN2NPEEPPOhQ9D.lza',
    role: Role.PHARMACIST,
    roles: [Role.PHARMACIST],
    isActive: true,
    lastLogin: new Date('2026-06-30T11:23:34.447Z'),
    createdAt: new Date('2026-06-22T05:43:54.914Z'),
    branchId: 'BRN-HQ',
    commissionRate: new Decimal('0'),
    preferences: {},
  },
  {
    id: 'cmqosilbc0006e3ez866y8128',
    name: 'Kumar Singh',
    email: 'inventory@pbims.com',
    phone: '9000000003',
    password: '$2b$10$o.fBvsh4z8wraGzvrRZG/uoBJ.6gh6wQQJqKYiLzbTDrgGX7L.vua',
    role: Role.INVENTORY_MANAGER,
    roles: [Role.INVENTORY_MANAGER],
    isActive: true,
    lastLogin: new Date('2026-06-30T10:25:37.550Z'),
    createdAt: new Date('2026-06-22T05:43:55.753Z'),
    branchId: 'BRN-HQ',
    commissionRate: new Decimal('0'),
    preferences: {},
  },
  {
    id: 'cmqosilri000ae3ez1l5ap624',
    name: 'Priya Sharma',
    email: 'accountant@pbims.com',
    phone: '9000000004',
    password: '$2b$10$0s/6Muutnj4Y7e7W6r/01.1BXxwEfzhg48yofp9ofTqSBg4L5h4Wu',
    role: Role.ACCOUNTANT,
    roles: [Role.ACCOUNTANT],
    isActive: true,
    lastLogin: new Date('2026-06-30T10:30:43.035Z'),
    createdAt: new Date('2026-06-22T05:43:56.335Z'),
    branchId: 'BRN-HQ',
    commissionRate: new Decimal('0'),
    preferences: {},
  },
  {
    id: 'cmqosim8a000ee3ez2xgym4nt',
    name: 'Santhosh R',
    email: 'pharmacist.chennai@pbims.com',
    phone: '9000000005',
    password: '$2b$10$Vfusm0KvQO7j6FIMcpZaSOy6LLu4INMjTvuEJNRSXOd902c3glflu',
    role: Role.PHARMACIST,
    roles: [Role.PHARMACIST],
    isActive: true,
    lastLogin: null as Date | null,
    createdAt: new Date('2026-06-22T05:43:56.938Z'),
    branchId: 'BRN-BR1',
    commissionRate: new Decimal('0'),
    preferences: {},
  },
  {
    id: 'cmqosimod000ie3ezmhn1s0o4',
    name: 'Divya M',
    email: 'inventory.chennai@pbims.com',
    phone: '9000000006',
    password: '$2b$10$65sdTb/KWRO6tVfnOVelvutuPgvZLicn/q4qyqZ4E7mus5HfWSDTq',
    role: Role.INVENTORY_MANAGER,
    roles: [Role.INVENTORY_MANAGER],
    isActive: true,
    lastLogin: null as Date | null,
    createdAt: new Date('2026-06-22T05:43:57.518Z'),
    branchId: 'BRN-BR1',
    commissionRate: new Decimal('0'),
    preferences: {},
  },
  {
    id: 'cmqosin3k000me3ezzdne6ltq',
    name: 'Anand K',
    email: 'accountant.chennai@pbims.com',
    phone: '9000000007',
    password: '$2b$10$dWt4WKBPQaEr9ybZPT/AnOnpfM6MyEUY/am.il/lFQXrIJG5xk10S',
    role: Role.ACCOUNTANT,
    roles: [Role.ACCOUNTANT],
    isActive: true,
    lastLogin: null as Date | null,
    createdAt: new Date('2026-06-22T05:43:58.064Z'),
    branchId: 'BRN-BR1',
    commissionRate: new Decimal('0'),
    preferences: {},
  },
  {
    id: 'cmqospbe40001ax1byb6yxsit',
    name: 'Arun',
    email: 'arun@gmail.com',
    phone: '9787421124',
    password: '$2b$10$oP4kKsK9sxKB4zjGtxAo0ukksoLRdJIekRbdAZrGXY3JlyphqY0Pm',
    role: Role.SALESPERSON,
    roles: [Role.SALESPERSON],
    isActive: true,
    lastLogin: new Date('2026-06-30T10:54:05.971Z'),
    createdAt: new Date('2026-06-22T05:49:09.484Z'),
    branchId: 'BRN-HQ',
    commissionRate: new Decimal('0'),
    preferences: {},
  },
  {
    id: 'cmqounp1z000112s8j9ni5u6t',
    name: 'Suriya',
    email: 'suriya@gmail.com',
    phone: '8056564775',
    password: '$2b$10$epLttLc9QpIVOoHbKh1cQ.4WH68y5YP26dZJjtEKVZn.Q3vxiffwC',
    role: Role.SALESPERSON,
    roles: [Role.SALESPERSON],
    isActive: true,
    lastLogin: new Date('2026-06-23T08:30:29.254Z'),
    createdAt: new Date('2026-06-22T06:43:53.111Z'),
    branchId: 'BRN-HQ',
    commissionRate: new Decimal('0'),
    preferences: {},
  },
  {
    id: 'cmqtfwq0n0001hyincnjp97c1',
    name: 'Raja ',
    email: 'raja@gmail.com',
    phone: '8056564775',
    password: '$2b$10$EtrCJZZp9uEldwY8efM6Q.TU/KDZ.CkXMoDlrw6ITgoT26bojKd3K',
    role: Role.ADMIN,
    roles: [Role.ADMIN],
    isActive: true,
    lastLogin: null as Date | null,
    createdAt: new Date('2026-06-25T11:49:50.899Z'),
    branchId: 'BRN-HQ',
    commissionRate: new Decimal('0'),
    preferences: {},
  },
  {
    id: 'cmqw5jhuf000xmv0p49czwzeg',
    name: 'Demo',
    email: 'demo@gmail.com',
    phone: '8056564775',
    password: '$2b$10$uqWi9z2q4MIqigFEmhG9pOfqOp4z9FCjv.pEceZyhed8/cZ/DkC8e',
    role: Role.PHARMACIST,
    roles: [Role.PHARMACIST, Role.INVENTORY_MANAGER, Role.ACCOUNTANT],
    isActive: true,
    lastLogin: new Date('2026-07-01T14:20:25.101Z'),
    createdAt: new Date('2026-06-27T09:22:56.145Z'),
    branchId: 'BRN-HQ',
    commissionRate: new Decimal('0'),
    preferences: {
      columns: {
        'billing.sales': ['date', 'customer', 'invoice', 'items', 'total', 'paid', 'balance', 'dueDate', 'payment', 'status'],
        'customers.list': ['name', 'phone', 'totalAmount', 'paidAmount', 'outstanding', 'type', 'source', 'pending'],
      },
    },
  },
];

async function main() {
  // ── Ensure branches exist (upsert so it's safe to re-run) ───────────────
  console.log('🏢 Upserting branches...');
  await prisma.branch.upsert({
    where: { id: 'BRN-HQ' },
    update: {},
    create: {
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
  await prisma.branch.upsert({
    where: { id: 'BRN-BR1' },
    update: {},
    create: {
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

  // ── Upsert users ────────────────────────────────────────────────────────
  console.log('👤 Upserting users...');
  for (const u of users) {
    const data = {
      name: u.name,
      phone: u.phone,
      password: u.password,
      role: u.role,
      roles: u.roles,
      isActive: u.isActive,
      lastLogin: u.lastLogin,
      branchId: u.branchId,
      commissionRate: u.commissionRate,
      preferences: u.preferences,
    };

    await prisma.user.upsert({
      where: { email: u.email },
      update: { ...data },
      create: { id: u.id, email: u.email, createdAt: u.createdAt, ...data },
    });

    // Ensure branchAccess row exists for users with a branch
    if (u.branchId) {
      const existing = await prisma.userBranch.findFirst({
        where: { userId: u.id, branchId: u.branchId },
      });
      if (!existing) {
        // Need to look up the actual user ID (may differ from seed ID on update)
        const dbUser = await prisma.user.findUnique({ where: { email: u.email } });
        if (dbUser) {
          await prisma.userBranch.upsert({
            where: {
              userId_branchId: { userId: dbUser.id, branchId: u.branchId },
            },
            update: {},
            create: { userId: dbUser.id, branchId: u.branchId },
          });
        }
      }
    }

    console.log(`  ✅ ${u.email} (${u.role})`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('✅  USERS SEED COMPLETE');
  console.log(`  BRANCHES : 2  (HQ Madurai + Chennai)`);
  console.log(`  USERS    : ${users.length}`);
  console.log('');
  console.log('  Credentials (all use pre-hashed passwords from dump):');
  for (const u of users) {
    const branch = u.branchId ?? 'All branches';
    console.log(`  ${u.email.padEnd(36)} → ${u.role.padEnd(20)} → ${branch}`);
  }
  console.log('═══════════════════════════════════════════════════════');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
