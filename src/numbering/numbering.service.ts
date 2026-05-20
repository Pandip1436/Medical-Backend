import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import {
  ConfigurableDocType,
  DOC_TYPES,
  FY_FORMATS,
  type FyFormatLiteral,
  UpsertNumberingConfigDto,
} from './dto/upsert-config.dto';

// Default config rendered for any (branch, docType) row that doesn't exist
// yet. Matches the historical hardcoded format `${type}/${fy}/${padded5}` so
// the UI shows what the system is currently producing.
const DEFAULT_TEMPLATE = (docType: string) => `${docType}/{FY}/{NN}`;
const DEFAULT_FY_FORMAT: FyFormatLiteral = 'YY-YY';
const DEFAULT_PADDING = 5;

@Injectable()
export class NumberingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Return a complete grid: one entry per supported docType, with the saved
   * config merged onto defaults so the UI never has to handle missing rows.
   * Also includes the current counter so the UI can show "next number".
   */
  async listConfigs(branchId: string | null) {
    const [rows, sequences] = await Promise.all([
      this.prisma.numberingConfig.findMany({ where: { branchId } }),
      this.prisma.documentSequence.findMany({
        where: {
          branchId,
          financialYear: DocumentNumberingService.getFinancialYear(),
        },
      }),
    ]);

    const rowMap = new Map(rows.map((r) => [r.docType, r]));
    const seqMap = new Map(sequences.map((s) => [s.docType, s.counter]));

    return DOC_TYPES.map((docType) => {
      const saved = rowMap.get(docType);
      const counter = seqMap.get(docType) ?? 0;
      return {
        docType,
        template: saved?.template ?? DEFAULT_TEMPLATE(docType),
        fyFormat: (saved?.fyFormat as FyFormatLiteral) ?? DEFAULT_FY_FORMAT,
        padding: saved?.padding ?? DEFAULT_PADDING,
        currentCounter: counter,           // last issued number
        nextCounter: counter + 1,          // what the next document will use
        isCustomized: !!saved,             // true if a row exists in NumberingConfig
      };
    });
  }

  async upsertConfig(
    branchId: string | null,
    docType: ConfigurableDocType,
    dto: UpsertNumberingConfigDto,
  ) {
    if (!dto.template.includes('{NN}')) {
      throw new BadRequestException('template must contain {NN} (the sequence token)');
    }
    if ((dto.template.match(/\{NN\}/g) ?? []).length > 1) {
      throw new BadRequestException('template must contain {NN} exactly once');
    }
    if ((dto.template.match(/\{FY\}/g) ?? []).length > 1) {
      throw new BadRequestException('template may contain {FY} at most once');
    }
    if (!FY_FORMATS.includes(dto.fyFormat)) {
      throw new BadRequestException(`fyFormat must be one of ${FY_FORMATS.join(', ')}`);
    }
    // Prisma rejects null in composite-key upsert when one column is nullable;
    // emulate upsert with a findFirst + create/update pair.
    const existing = await this.prisma.numberingConfig.findFirst({
      where: { branchId, docType },
    });
    if (existing) {
      return this.prisma.numberingConfig.update({
        where: { id: existing.id },
        data: {
          template: dto.template,
          fyFormat: dto.fyFormat,
          padding: dto.padding,
        },
      });
    }
    return this.prisma.numberingConfig.create({
      data: {
        branchId,
        docType,
        template: dto.template,
        fyFormat: dto.fyFormat,
        padding: dto.padding,
      },
    });
  }

  /**
   * Adjust the starting number for the current financial year — skip-forward
   * only. Sets `counter = startFrom - 1` so the next document increments to
   * `startFrom`. Records an explicit audit-log entry with old + new counter
   * (the global interceptor only captures request bodies, no `oldValue`).
   */
  async setStartFrom(
    branchId: string | null,
    docType: ConfigurableDocType,
    startFrom: number,
    userId: string,
    ipAddress: string | null,
  ) {
    const fy = DocumentNumberingService.getFinancialYear();
    const key = `${docType}:${branchId ?? 'GLOBAL'}:${fy}`;

    const existing = await this.prisma.documentSequence.findUnique({ where: { key } });
    const currentCounter = existing?.counter ?? 0;
    const newCounter = startFrom - 1;

    if (newCounter <= currentCounter) {
      throw new BadRequestException(
        `Starting number must be greater than the next number that would be issued. ` +
          `Current counter is ${currentCounter}; next issued would be ${currentCounter + 1}.`,
      );
    }

    await this.prisma.documentSequence.upsert({
      where: { key },
      update: { counter: newCounter },
      create: {
        key,
        docType,
        branchId,
        financialYear: fy,
        counter: newCounter,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        module: 'numbering',
        action: 'SET_START',
        entity: 'DocumentSequence',
        entityId: key,
        oldValue: { counter: currentCounter, nextNumber: currentCounter + 1 },
        newValue: { counter: newCounter, nextNumber: startFrom },
        ipAddress,
      },
    });

    return { docType, currentCounter: newCounter, nextNumber: startFrom };
  }

  /**
   * Pure preview — never touches the DB. Mirrors the renderer in
   * DocumentNumberingService so the UI can show a live preview without saving.
   */
  preview(template: string, fyFormat: FyFormatLiteral, padding: number, sample: number) {
    const { fyStart, fyEnd } = DocumentNumberingService.getFyParts();
    const FY = DocumentNumberingService.formatFy(fyStart, fyEnd, fyFormat);
    const NN = String(Math.max(1, sample)).padStart(padding, '0');
    return DocumentNumberingService.applyTemplate(template, { FY, NN });
  }
}
