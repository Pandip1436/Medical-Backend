import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type DocType = 'PO' | 'GRN' | 'DN';

@Injectable()
export class DocumentNumberingService {
  static getFinancialYear(date: Date = new Date()): string {
    // Indian FY runs April -> March. April 2026 -> "26-27".
    const month = date.getMonth();
    const year = date.getFullYear();
    const fyStart = month >= 3 ? year : year - 1;
    const fyEnd = fyStart + 1;
    const yy = (n: number) => String(n % 100).padStart(2, '0');
    return `${yy(fyStart)}-${yy(fyEnd)}`;
  }

  // Must be called inside a Prisma transaction so the sequence rolls back if the
  // surrounding write fails (no gaps from aborted creates).
  async nextNumber(
    tx: Prisma.TransactionClient,
    docType: DocType,
    branchId?: string | null,
  ): Promise<string> {
    const fy = DocumentNumberingService.getFinancialYear();
    const scope = branchId ?? 'GLOBAL';
    const key = `${docType}:${scope}:${fy}`;

    const seq = await tx.documentSequence.upsert({
      where: { key },
      update: { counter: { increment: 1 } },
      create: {
        key,
        docType,
        branchId: branchId ?? null,
        financialYear: fy,
        counter: 1,
      },
    });

    return `${docType}/${fy}/${String(seq.counter).padStart(5, '0')}`;
  }
}
