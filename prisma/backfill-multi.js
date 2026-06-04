/**
 * One-off backfill for the multi-role / multi-branch migration.
 *   - Promotes the global admin (ADMIN with no branch) to SUPER_ADMIN.
 *   - Seeds `roles` from the existing singular `role` for everyone else.
 *   - Creates UserBranch rows from each user's existing `branchId`.
 * Uses raw SQL so it does not depend on a freshly-generated Prisma client.
 * Idempotent — safe to re-run.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 1. Global admins (ADMIN + no home branch) become SUPER_ADMIN.
  const superAdmins = await prisma.$executeRawUnsafe(`
    UPDATE "User"
    SET role = 'SUPER_ADMIN', roles = ARRAY['SUPER_ADMIN']::"Role"[]
    WHERE role = 'ADMIN' AND "branchId" IS NULL
  `);

  // 2. Everyone else: seed roles[] from the singular role (only if empty).
  const seeded = await prisma.$executeRawUnsafe(`
    UPDATE "User"
    SET roles = ARRAY[role]::"Role"[]
    WHERE roles IS NULL OR cardinality(roles) = 0
  `);

  // 3. Create the allowed-branch set from each user's home branch.
  const branchRows = await prisma.$executeRawUnsafe(`
    INSERT INTO "UserBranch" (id, "userId", "branchId")
    SELECT gen_random_uuid()::text, id, "branchId"
    FROM "User"
    WHERE "branchId" IS NOT NULL
    ON CONFLICT ("userId", "branchId") DO NOTHING
  `);

  console.log(`Promoted ${superAdmins} super-admin(s), seeded roles on ${seeded} user(s), created ${branchRows} branch-access row(s).`);

  const sample = await prisma.$queryRawUnsafe(`
    SELECT email, role, roles, "branchId" FROM "User" ORDER BY "createdAt" LIMIT 20
  `);
  console.table(sample);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
