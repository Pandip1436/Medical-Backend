# Manual production migration

Migrations normally run automatically as a Cloud Build step on every deploy
(see `cloudbuild.yaml`). Use this guide only when you need to apply a
migration **outside the deploy pipeline** — for example, to recover from a
half-applied migration, or when you want the schema in place before the new
code rolls out.

## Prerequisites

- Network that can reach Neon (`*.neon.tech`). Some local DNS / Wi-Fi
  setups in India block this; switching to mobile hotspot or a different
  network usually fixes it. Confirm with:
  ```
  nslookup ep-frosty-sea-a1jw6ef1-pooler.ap-southeast-1.aws.neon.tech
  ```
- The PROD `DATABASE_URL` (from the Cloud Run service env or a vault).

## Apply pending migrations to prod

From `medical-backend/`:

### PowerShell (Windows)

```powershell
$env:DATABASE_URL = "postgresql://...prod-url..."
npx prisma migrate deploy
Remove-Item Env:DATABASE_URL   # clean up so dev commands hit the dev DB again
```

### Bash / WSL

```bash
DATABASE_URL="postgresql://...prod-url..." npx prisma migrate deploy
```

(The inline form keeps the prod URL out of your shell history beyond this
single command.)

## What the command does

`prisma migrate deploy` only **applies pending migrations**. It never
generates new migration files, never modifies existing ones, and is safe to
run multiple times — already-applied migrations are skipped.

## After running

Trigger a Cloud Run redeploy of the *same* commit (Cloud Run UI → "Edit &
deploy new revision" → keep all settings → Deploy). The cloudbuild migrate
step will see all migrations are already applied and skip straight to the
deploy step.

## Why we keep this around

The Cloud Build step is the normal path. This manual escape hatch matters
when:
- A deploy is already broken and you need to apply a migration to unblock
  the next deploy.
- You want to apply schema changes ahead of code (e.g. a feature-flag
  rollout that adds nullable columns first, then ships code that reads
  them).
