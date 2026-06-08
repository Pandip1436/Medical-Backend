# Migration History Re-Baseline Runbook

**Status:** ready to execute · **Risk to data:** none if steps followed (resets only Prisma bookkeeping) · **Coordinate with:** your coworker (this rewrites shared migration history)

> **Canonical database = `development`** (the Neon branch you and your coworker actually use). The `production` branch is the unused parent and is ignored here. We prove everything on a throwaway **`Dev-child`** branch first, then cut over to `development`.

---

## Why we're doing this

The migration history diverged from the live `development` database and **cannot be replayed from scratch**:

1. **`db push` drift** — `development` was partly built with `prisma db push`, so objects like `Category`, `Payment`, `ApprovalRequest`, `StockAdjustmentLog`, `Notification`, `CustomerReminder`, `ReminderContact`, the `Product.category → categoryId` change, and `CustomerType` value changes exist in the **database** but were never created by any **migration**.
2. Because of #1, `prisma migrate dev`'s from-scratch shadow replay fails (P3006) regardless of which migration files you use.
3. Hand-editing old migrations to patch this only causes "modified after applied" errors.

The fix is a one-time **re-baseline**: collapse the whole history into a single baseline migration that matches the *real* database, mark it **already-applied** (so no SQL runs against your data), then continue with normal migrations.

> **Data safety:** every step either reads the DB, edits local files, or resets the `_prisma_migrations` *bookkeeping* table. **None of it drops or alters your data tables.** And the risky parts run on a disposable `Dev-child` copy first.

---

## Phase 0 — Create the sandbox (you are here)

In Neon → **Create child branch**:
- **Name:** `Dev-child`
- **Parent:** `development`  ← your real DB
- **Branch data and schema** (full copy)
- **Auto-delete:** 3 days or "No auto-delete" (so it survives multi-day work)

This is an instant, free, exact copy of `development`. Everything in Phases 2–6 runs against **`Dev-child` only**.

---

## Phase 1 — Point local `.env` at the sandbox

Copy `Dev-child`'s connection strings from Neon into `.env`:
```
DATABASE_URL="<DEV-CHILD POOLED URL>"
DIRECT_URL="<DEV-CHILD DIRECT URL>"
```
Confirm: `npx prisma validate` passes (schema.prisma already has your fixes + the Delivery merge).

---

## Phase 2 — Generate the baseline from the sandbox's real schema

```powershell
# archive the old history (keep it — do NOT delete)
New-Item -ItemType Directory prisma\migrations_archive -Force
Move-Item prisma\migrations\* prisma\migrations_archive\

# create the baseline folder
New-Item -ItemType Directory prisma\migrations\0_baseline -Force

# render the sandbox's CURRENT schema into the baseline (read-only)
npx prisma migrate diff --from-empty --to-url "<DEV-CHILD DIRECT URL>" --script > prisma\migrations\0_baseline\migration.sql
```
Open `0_baseline\migration.sql` and confirm it has all tables/enums (Delivery* included).

---

## Phase 3 — Reset bookkeeping + mark baseline applied (on the sandbox)

```powershell
# 1) clear Prisma's migration records ONLY (your data tables are untouched)
'DELETE FROM "_prisma_migrations";' | Out-File -Encoding utf8 reset_bookkeeping.sql
npx prisma db execute --url "<DEV-CHILD DIRECT URL>" --file reset_bookkeeping.sql

# 2) mark the baseline as already-applied (writes ONE row; runs NO schema SQL)
npx prisma migrate resolve --applied 0_baseline
```

---

## Phase 4 — Verify

```powershell
npx prisma migrate status
```
Expect: baseline applied, **no** "modified after applied", **no** "missing" migrations.

---

## Phase 5 — Shadow DB for `migrate dev` (Neon)

`migrate dev` needs a shadow database it can create/drop; the Neon user can't, so point it at a throwaway branch:
1. Neon → create a branch named `shadow` (parent can be `development`).
2. `.env`: `SHADOW_DATABASE_URL="<SHADOW DIRECT URL>"`
3. `schema.prisma` `datasource db { ... }`: add `shadowDatabaseUrl = env("SHADOW_DATABASE_URL")`

---

## Phase 6 — Apply your real changes as the first migration (on the sandbox)

```powershell
npx prisma migrate dev --name nullable_mfgdate_and_last_price_update
```
**Review the generated SQL.** It should contain ONLY:
- `ALTER TABLE "Batch" ALTER COLUMN "mfgDate" DROP NOT NULL;`
- `ALTER TABLE "GRNItem" ALTER COLUMN "mfgDate" DROP NOT NULL;`
- `ALTER TABLE "Product" ADD COLUMN "lastPriceUpdate" TIMESTAMP(3);`

⚠️ If it shows anything else (especially `DROP COLUMN`/`DROP TABLE`/type changes), **STOP** — `schema.prisma` still differs from the baseline; reconcile before continuing.

Then start the app against `Dev-child` and smoke-test. ✅ If everything works, the migrations folder is **proven**.

---

## Phase 7 — Cut over to the real `development` DB

1. **Back up `development`:** Neon → create a branch off `development` (your restore point).
2. Point `.env` back at `development`:
   ```
   DATABASE_URL="<DEVELOPMENT POOLED URL>"
   DIRECT_URL="<DEVELOPMENT DIRECT URL>"
   ```
3. Reset bookkeeping + apply baseline on `development` (same as Phase 3, runs no schema SQL):
   ```powershell
   npx prisma db execute --url "<DEVELOPMENT DIRECT URL>" --file reset_bookkeeping.sql
   npx prisma migrate resolve --applied 0_baseline
   ```
4. Apply the new migration (only the additive `mfgDate`/`lastPriceUpdate` change runs):
   ```powershell
   npx prisma migrate deploy
   ```
5. `npx prisma migrate status` → clean.

---

## Phase 8 — Commit & coordinate

- Commit `prisma/migrations/0_baseline` + the new migration.
- Coworker: `git pull`, then run **Phase 3** once against any other DB they have (or just re-point at `development`).
- Delete the `Dev-child` and `shadow` branches when done. Keep `prisma/migrations_archive` a few weeks, then remove.
- Clean up `reset_bookkeeping.sql`.

---

## Rollback

At any phase, restore the relevant Neon branch from its Phase-0 / Phase-7 snapshot. No data lost. Reassess before retrying.

---

## Project-specific notes

- The 5 migrations I had hand-edited are **reverted to their originals** (they match what `development` applied). Moot after Phase 2 anyway, since the folder is archived.
- The 2 delivery migrations (`20260607000000_add_delivery_tracking`, `20260607010000_delivery_carrier_sync`) are correct and are captured automatically by the Phase 2 baseline.
- Do **not** run `prisma migrate dev` directly against `development` until you've proven the flow on `Dev-child` — until the baseline exists it keeps offering to **reset (wipe)** the database.
- `production` is unused; if you ever start using it, run Phase 7 against it too.
