import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Atomic lead-number generator: "L-0001", "L-0002", ...
 *
 * Reuses the existing DocumentSequence table (the same one PO/GRN/DN use).
 * Key shape: "LEAD:<branchId|GLOBAL>:<FY>" — we go GLOBAL for leads since
 * branch-scoped numbering would make merged-pipeline reports awkward.
 *
 * INSERT ... ON CONFLICT DO UPDATE serialises concurrent writers on the
 * single row, so two parallel requests can never claim the same number.
 */
@Injectable()
export class LeadNumberingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Next lead number, formatted as L-0001 (4-digit zero-padded). */
  async next(): Promise<string> {
    const fy = financialYear(new Date());
    const key = `LEAD:GLOBAL:${fy}`;
    const rows = await this.prisma.$queryRaw<Array<{ counter: number }>>`
      INSERT INTO "DocumentSequence" ("id", "key", "docType", "branchId", "financialYear", "counter", "updatedAt")
      VALUES (gen_random_uuid()::text, ${key}, 'LEAD', NULL, ${fy}, 1, NOW())
      ON CONFLICT ("key") DO UPDATE
        SET "counter" = "DocumentSequence"."counter" + 1,
            "updatedAt" = NOW()
      RETURNING "counter"
    `;
    const n = rows[0]?.counter ?? 1;
    return `L-${n.toString().padStart(4, '0')}`;
  }
}

// "26-27" for FY starting Apr 2026 — matches the format the PO/GRN
// numberers use.
function financialYear(date: Date): string {
  const month = date.getMonth() + 1; // 1..12
  const year = date.getFullYear();
  const startYear = month >= 4 ? year : year - 1;
  const endYear = startYear + 1;
  return `${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`;
}
