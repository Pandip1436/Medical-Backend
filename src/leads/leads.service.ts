import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  LeadStage,
  LeadStatus,
  LeadTouchStatus,
  LeadSource,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ContactsService } from '../contacts/contacts.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import {
  ImportLeadRowDto,
  ImportLeadsDto,
  ImportLeadsResult,
} from './dto/import-leads.dto';
import { LeadNumberingService } from './lead-numbering.service';

// Tabs surfaced by the leads list top bar. "open" / "closed" map to
// LeadStatus; "untouched" maps to LeadTouchStatus; the stage tabs map
// directly to LeadStage. "all" applies no filter.
export type LeadTab =
  | 'all'
  | 'open'
  | 'closed'
  | 'untouched'
  | 'lead'
  | 'qualified'
  | 'proposal'
  | 'negotiation'
  | 'won'
  | 'lost';

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly numbering: LeadNumberingService,
  ) {}

  private include = {
    contact: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        phoneCountryCode: true,
        email: true,
        jobTitle: true,
        city: true,
        state: true,
        country: true,
      },
    },
    company: { select: { id: true, name: true } },
    assignedToUser: { select: { id: true, name: true, email: true } },
  } satisfies Prisma.LeadInclude;

  /**
   * GET /leads — paginated list + tab counts in one shot.
   * Counts are computed *under the same non-tab filters* so the pill numbers
   * stay accurate when search/source/date filters are applied.
   */
  async findAll(opts: {
    q?: string;
    tab?: LeadTab;
    stage?: LeadStage[];
    source?: LeadSource[];
    assignedToUserId?: string;
    branchId?: string;
    createdFrom?: string;
    createdTo?: string;
    updatedFrom?: string;
    updatedTo?: string;
    page?: number;
    take?: number;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
  }) {
    const baseWhere = this.buildBaseWhere(opts);

    // Tab filter is layered ON TOP of the base where (which already includes
    // search / source / dates / assignee / branch). We materialise both:
    //   - listWhere: base + tab → drives the actual page query
    //   - baseWhere: just the base → drives the tab pill counts
    const listWhere: Prisma.LeadWhereInput = { ...baseWhere };
    this.applyTabFilter(listWhere, opts.tab);

    const take = Math.min(Math.max(opts.take ?? 50, 1), 200);
    const page = Math.max(opts.page ?? 1, 1);
    const skip = (page - 1) * take;

    const orderBy: Prisma.LeadOrderByWithRelationInput = this.parseSort(
      opts.sortBy,
      opts.sortDir,
    );

    const [data, total, counts] = await Promise.all([
      this.prisma.lead.findMany({
        where: listWhere,
        include: this.include,
        orderBy,
        take,
        skip,
      }),
      this.prisma.lead.count({ where: listWhere }),
      this.computeCounts(baseWhere),
    ]);

    return { data, total, page, take, counts };
  }

  async findOne(id: string, branchId?: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        ...this.include,
        contact: { include: { company: true, ownerUser: { select: { id: true, name: true } } } },
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    if (branchId && lead.branchId !== branchId) {
      throw new NotFoundException('Lead not found');
    }
    return lead;
  }

  async create(
    dto: CreateLeadDto,
    ctx: { branchId: string; userId: string },
  ) {
    if (!ctx.branchId) {
      throw new BadRequestException('branchId is required to create a lead');
    }
    if (!dto.contactId && !dto.contact) {
      throw new BadRequestException(
        'Either contactId or a new contact payload is required',
      );
    }

    // Resolve contact: existing OR create-on-the-fly. Done outside the
    // transaction because contacts.service.create has its own validation.
    let contactId = dto.contactId;
    if (!contactId && dto.contact) {
      const created = await this.contacts.create(dto.contact, {
        branchId: ctx.branchId,
        userId: ctx.userId,
      });
      contactId = created.id;
    }

    const leadNumber = await this.numbering.next();

    return this.prisma.lead.create({
      data: {
        leadNumber,
        title: dto.title.trim(),
        description: dto.description ?? null,
        source: dto.source ?? 'MANUAL',
        pipeline: dto.pipeline ?? 'SALES',
        stage: dto.stage ?? 'LEAD',
        score: dto.score ?? 50,
        value: dto.value ?? 0,
        currency: dto.currency ?? 'INR',
        expectedCloseDate: dto.expectedCloseDate
          ? new Date(dto.expectedCloseDate)
          : null,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        // Requirement details (mirrors the IndiaMART payload) — lets a manual
        // lead populate the "Requirements" card.
        externalProductName: dto.externalProductName?.trim() || null,
        externalCategory: dto.externalCategory?.trim() || null,
        externalCity: dto.externalCity?.trim() || null,
        externalState: dto.externalState?.trim() || null,
        externalMessage: dto.externalMessage?.trim() || null,
        contact: { connect: { id: contactId! } },
        ...(dto.companyId && { company: { connect: { id: dto.companyId } } }),
        assignedToUser: {
          connect: { id: dto.assignedToUserId ?? ctx.userId },
        },
        branch: { connect: { id: ctx.branchId } },
      },
      include: this.include,
    });
  }

  async update(id: string, dto: UpdateLeadDto, branchId?: string) {
    await this.findOne(id, branchId);

    const data: Prisma.LeadUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.source !== undefined) data.source = dto.source;
    if (dto.pipeline !== undefined) data.pipeline = dto.pipeline;
    if (dto.stage !== undefined) {
      data.stage = dto.stage;
      // Won/Lost auto-close. Re-opening from a terminal stage requires the
      // caller to also send status: OPEN explicitly.
      if (dto.stage === 'WON' || dto.stage === 'LOST') {
        data.status = LeadStatus.CLOSED;
      }
    }
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.touchStatus !== undefined) data.touchStatus = dto.touchStatus;
    if (dto.score !== undefined) data.score = dto.score;
    if (dto.value !== undefined) data.value = dto.value;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.expectedCloseDate !== undefined) {
      data.expectedCloseDate = dto.expectedCloseDate
        ? new Date(dto.expectedCloseDate)
        : null;
    }
    if (dto.validUntil !== undefined) {
      data.validUntil = dto.validUntil ? new Date(dto.validUntil) : null;
    }
    if (dto.contactId !== undefined) {
      data.contact = { connect: { id: dto.contactId } };
    }
    if (dto.companyId !== undefined) {
      data.company = dto.companyId
        ? { connect: { id: dto.companyId } }
        : { disconnect: true };
    }
    if (dto.assignedToUserId !== undefined) {
      data.assignedToUser = { connect: { id: dto.assignedToUserId } };
    }

    return this.prisma.lead.update({
      where: { id },
      data,
      include: this.include,
    });
  }

  async remove(id: string, branchId?: string) {
    await this.findOne(id, branchId);
    // LeadActivity cascade-deletes via FK. Invoices/Quotations leadId
    // is set to NULL by the schema (ON DELETE SET NULL).
    return this.prisma.lead.delete({ where: { id } });
  }

  /**
   * Bulk patch — used by the floating "bulk actions" bar on the leads table.
   * Caller must pre-restrict to ids they're allowed to mutate; we just apply.
   */
  async bulkUpdate(
    ids: string[],
    patch: Pick<UpdateLeadDto, 'stage' | 'status' | 'assignedToUserId'>,
    branchId?: string,
  ) {
    if (ids.length === 0) return { count: 0 };
    const where: Prisma.LeadWhereInput = { id: { in: ids } };
    if (branchId) where.branchId = branchId;
    // Unchecked variant lets us set the FK scalar directly without a connect.
    const data: Prisma.LeadUncheckedUpdateManyInput = {};
    if (patch.stage) data.stage = patch.stage;
    if (patch.status) data.status = patch.status;
    if (patch.assignedToUserId) data.assignedToUserId = patch.assignedToUserId;
    return this.prisma.lead.updateMany({ where, data });
  }

  async bulkDelete(ids: string[], branchId?: string) {
    if (ids.length === 0) return { count: 0 };
    const where: Prisma.LeadWhereInput = { id: { in: ids } };
    if (branchId) where.branchId = branchId;
    return this.prisma.lead.deleteMany({ where });
  }

  /**
   * Bulk export — used by the "Export Leads" drawer. Same filter params as
   * `findAll`, but returns every matching row (no pagination) with the full
   * contact + company joins so the client can format any column the user
   * picks. Capped at 50,000 rows to keep the response size sane; the client
   * surfaces a friendly error when the cap is hit.
   */
  async export(opts: {
    q?: string;
    tab?: LeadTab;
    stage?: LeadStage[];
    source?: LeadSource[];
    assignedToUserId?: string;
    branchId?: string;
    createdFrom?: string;
    createdTo?: string;
    updatedFrom?: string;
    updatedTo?: string;
    ids?: string[];
  }) {
    const EXPORT_CAP = 50_000;

    // If `ids[]` is supplied, the explicit-selection scope wins — we ignore
    // the filter params and pull exactly those rows. Otherwise the export
    // matches whatever the leads list itself would show.
    let where: Prisma.LeadWhereInput;
    if (opts.ids && opts.ids.length > 0) {
      where = { id: { in: opts.ids } };
      if (opts.branchId) where.branchId = opts.branchId;
    } else {
      where = this.buildBaseWhere(opts);
      this.applyTabFilter(where, opts.tab);
    }

    const total = await this.prisma.lead.count({ where });
    if (total > EXPORT_CAP) {
      throw new BadRequestException(
        `Refusing to export ${total.toLocaleString()} rows — cap is ${EXPORT_CAP.toLocaleString()}. Narrow the filters first.`,
      );
    }

    return this.prisma.lead.findMany({
      where,
      include: {
        contact: true,
        company: { select: { id: true, name: true, industry: true } },
        assignedToUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_CAP,
    });
  }

  /**
   * Bulk import — used by the "Import Leads from CSV" drawer. Each row is
   * already mapped (the frontend handled the CSV → field mapping), so we
   * just need to:
   *
   *   1. Find or create the Contact (match by branch + phone, then by email).
   *   2. Apply `duplicateHandling` when a match is found:
   *        UPDATE → patch the existing contact + create a new Lead anchored to it
   *        SKIP   → don't touch this row, count it as skipped
   *        CREATE → ignore the match, create a brand-new contact + lead
   *   3. Resolve/create the Company by name.
   *   4. Mint a lead number and create the Lead with `defaultStage` /
   *      `defaultSource` applied to rows that don't carry their own value.
   *
   * Per-row failures are caught and reported in `errors[]` so a malformed
   * row never blocks the rest of the import.
   */
  async importLeads(
    dto: ImportLeadsDto,
    ctx: { branchId: string; userId: string },
  ): Promise<ImportLeadsResult> {
    if (!ctx.branchId) {
      throw new BadRequestException('branchId is required to import leads');
    }

    const result: ImportLeadsResult = {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    // Sequential — keeps phone-uniqueness contention out of the way and lets
    // us return precise row-level errors. CSV imports are infrequent so the
    // throughput cost is acceptable.
    for (let i = 0; i < dto.leads.length; i++) {
      const row = dto.leads[i];
      try {
        await this.importOneRow(row, dto, ctx, result)
      } catch (err) {
        const msg =
          (err as { message?: string })?.message ?? 'Unknown import error';
        result.errors.push({ row: i + 1, message: msg });
      }
    }

    return result;
  }

  /** Single-row import helper — see importLeads() for the contract. */
  private async importOneRow(
    row: ImportLeadRowDto,
    dto: ImportLeadsDto,
    ctx: { branchId: string; userId: string },
    result: ImportLeadsResult,
  ): Promise<void> {
    if (!row.title || !row.title.trim()) {
      throw new BadRequestException('title is required');
    }
    if (!row.phone && !row.email && !row.firstName) {
      throw new BadRequestException(
        'at least one of firstName / phone / email is required',
      );
    }

    // Locate any existing contact in this branch by phone first, then email.
    let existingContact: { id: string } | null = null;
    if (row.phone) {
      existingContact = await this.prisma.contact.findUnique({
        where: { branchId_phone: { branchId: ctx.branchId, phone: row.phone } },
        select: { id: true },
      });
    }
    if (!existingContact && row.email) {
      existingContact = await this.prisma.contact.findFirst({
        where: { branchId: ctx.branchId, email: row.email },
        select: { id: true },
      });
    }

    if (existingContact && dto.duplicateHandling === 'SKIP') {
      result.skipped++;
      return;
    }

    // Optional company match by name within this branch.
    let companyId: string | undefined;
    if (row.company && row.company.trim()) {
      const trimmed = row.company.trim();
      const existing = await this.prisma.company.findFirst({
        where: { branchId: ctx.branchId, name: trimmed },
        select: { id: true },
      });
      if (existing) {
        companyId = existing.id;
      } else {
        const created = await this.prisma.company.create({
          data: { name: trimmed, branchId: ctx.branchId },
          select: { id: true },
        });
        companyId = created.id;
      }
    }

    let contactId: string;
    if (existingContact && dto.duplicateHandling === 'UPDATE') {
      // Update the contact's mutable fields. We deliberately don't change
      // phone (matched on it) so the unique index stays stable.
      await this.prisma.contact.update({
        where: { id: existingContact.id },
        data: {
          firstName: row.firstName?.trim() || undefined,
          lastName: row.lastName?.trim() || undefined,
          email: row.email?.trim() || undefined,
          jobTitle: row.jobTitle?.trim() || undefined,
          address: row.address?.trim() || undefined,
          city: row.city?.trim() || undefined,
          state: row.state?.trim() || undefined,
          country: row.country?.trim() || undefined,
          ...(companyId && { companyId }),
        },
      });
      contactId = existingContact.id;
      result.updated++;
    } else {
      // CREATE branch — either no existing match, or caller asked for
      // CREATE even when matches exist. We still need a phone for the
      // unique key; if the row didn't carry one, synthesize a placeholder
      // off the leadNumber so the import doesn't fail.
      const safePhone =
        row.phone?.trim() || `imp-${Date.now()}-${result.imported}`;
      const created = await this.prisma.contact.create({
        data: {
          firstName: (row.firstName?.trim() || 'Unknown').slice(0, 60),
          lastName: row.lastName?.trim() || null,
          phoneCountryCode: row.phoneCountryCode?.trim() || '+91',
          phone: safePhone,
          email: row.email?.trim() || null,
          jobTitle: row.jobTitle?.trim() || null,
          address: row.address?.trim() || null,
          city: row.city?.trim() || null,
          state: row.state?.trim() || null,
          country: row.country?.trim() || null,
          source: row.source ?? dto.defaultSource ?? 'OTHER',
          ownerUserId: ctx.userId,
          branchId: ctx.branchId,
          ...(companyId && { companyId }),
        },
        select: { id: true },
      });
      contactId = created.id;
    }

    const leadNumber = await this.numbering.next();
    await this.prisma.lead.create({
      data: {
        leadNumber,
        title: row.title.trim(),
        description: row.description?.trim() || null,
        source: row.source ?? dto.defaultSource ?? 'OTHER',
        stage: row.stage ?? dto.defaultStage ?? 'LEAD',
        score: typeof row.score === 'number' ? row.score : 50,
        value: row.value != null ? Number(row.value) || 0 : 0,
        currency: 'INR',
        contactId,
        ...(companyId && { companyId }),
        assignedToUserId: ctx.userId,
        branchId: ctx.branchId,
      },
    });
    result.imported++;
  }

  /**
   * Quotations linked to this lead (Quotation.leadId === leadId).
   * Powers the right-panel Quotations tab.
   */
  async findQuotations(leadId: string, branchId?: string) {
    await this.assertLeadVisible(leadId, branchId);
    return this.prisma.quotation.findMany({
      where: { leadId },
      orderBy: { date: 'desc' },
      include: {
        items: { select: { id: true, productName: true, quantity: true, rate: true, amount: true } },
      },
    });
  }

  /**
   * Invoices linked to this lead (Invoice.leadId === leadId).
   * Powers the right-panel Invoices tab.
   */
  async findInvoices(leadId: string, branchId?: string) {
    await this.assertLeadVisible(leadId, branchId);
    return this.prisma.invoice.findMany({
      where: { leadId },
      orderBy: { date: 'desc' },
      select: {
        id: true,
        invoiceNumber: true,
        date: true,
        customerName: true,
        grandTotal: true,
        amountPaid: true,
        status: true,
        type: true,
      },
    });
  }

  /**
   * Branch-scope assertion reused by tab endpoints. Kept private; the tab
   * methods call it before any of their fan-out queries.
   */
  private async assertLeadVisible(id: string, branchId?: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      select: { id: true, branchId: true },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    if (branchId && lead.branchId !== branchId) {
      throw new NotFoundException('Lead not found');
    }
    return lead;
  }

  // ─────────── internals ───────────

  private buildBaseWhere(opts: Parameters<LeadsService['findAll']>[0]) {
    const where: Prisma.LeadWhereInput = {};
    if (opts.branchId) where.branchId = opts.branchId;
    if (opts.assignedToUserId) where.assignedToUserId = opts.assignedToUserId;
    if (opts.source && opts.source.length > 0) {
      where.source = { in: opts.source };
    }
    if (opts.q) {
      const q = opts.q;
      where.OR = [
        { leadNumber: { contains: q, mode: 'insensitive' } },
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { contact: { firstName: { contains: q, mode: 'insensitive' } } },
        { contact: { lastName: { contains: q, mode: 'insensitive' } } },
        { contact: { phone: { contains: q } } },
        { contact: { email: { contains: q, mode: 'insensitive' } } },
      ];
    }
    if (opts.createdFrom || opts.createdTo) {
      where.createdAt = {};
      if (opts.createdFrom) where.createdAt.gte = new Date(opts.createdFrom);
      if (opts.createdTo) where.createdAt.lte = new Date(opts.createdTo);
    }
    if (opts.updatedFrom || opts.updatedTo) {
      where.updatedAt = {};
      if (opts.updatedFrom) where.updatedAt.gte = new Date(opts.updatedFrom);
      if (opts.updatedTo) where.updatedAt.lte = new Date(opts.updatedTo);
    }
    if (opts.stage && opts.stage.length > 0) {
      where.stage = { in: opts.stage };
    }
    return where;
  }

  private applyTabFilter(
    where: Prisma.LeadWhereInput,
    tab: LeadTab | undefined,
  ): void {
    switch (tab) {
      case 'open':
        where.status = LeadStatus.OPEN;
        return;
      case 'closed':
        where.status = LeadStatus.CLOSED;
        return;
      case 'untouched':
        where.touchStatus = LeadTouchStatus.UNTOUCHED;
        return;
      case 'lead':
        where.stage = LeadStage.LEAD;
        return;
      case 'qualified':
        where.stage = LeadStage.QUALIFIED;
        return;
      case 'proposal':
        where.stage = LeadStage.PROPOSAL;
        return;
      case 'negotiation':
        where.stage = LeadStage.NEGOTIATION;
        return;
      case 'won':
        where.stage = LeadStage.WON;
        return;
      case 'lost':
        where.stage = LeadStage.LOST;
        return;
      default:
        return; // 'all' or undefined → no extra filter
    }
  }

  /** Run a single groupBy + a couple of targeted counts to fill the pill row. */
  private async computeCounts(baseWhere: Prisma.LeadWhereInput) {
    // We strip stage/status/touchStatus from baseWhere when computing counts
    // so each pill shows the count INDEPENDENT of the active tab.
    const cleanBase: Prisma.LeadWhereInput = { ...baseWhere };
    delete (cleanBase as { stage?: unknown }).stage;
    delete (cleanBase as { status?: unknown }).status;
    delete (cleanBase as { touchStatus?: unknown }).touchStatus;

    const [byStage, byStatus, untouched, all] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['stage'],
        where: cleanBase,
        _count: { _all: true },
      }),
      this.prisma.lead.groupBy({
        by: ['status'],
        where: cleanBase,
        _count: { _all: true },
      }),
      this.prisma.lead.count({
        where: { ...cleanBase, touchStatus: LeadTouchStatus.UNTOUCHED },
      }),
      this.prisma.lead.count({ where: cleanBase }),
    ]);

    const stageMap = Object.fromEntries(
      byStage.map((r) => [r.stage, r._count._all]),
    ) as Record<LeadStage, number>;
    const statusMap = Object.fromEntries(
      byStatus.map((r) => [r.status, r._count._all]),
    ) as Record<LeadStatus, number>;

    return {
      all,
      open: statusMap.OPEN ?? 0,
      closed: statusMap.CLOSED ?? 0,
      untouched,
      lead: stageMap.LEAD ?? 0,
      qualified: stageMap.QUALIFIED ?? 0,
      proposal: stageMap.PROPOSAL ?? 0,
      negotiation: stageMap.NEGOTIATION ?? 0,
      won: stageMap.WON ?? 0,
      lost: stageMap.LOST ?? 0,
    };
  }

  private parseSort(
    sortBy: string | undefined,
    sortDir: 'asc' | 'desc' | undefined,
  ): Prisma.LeadOrderByWithRelationInput {
    const dir = sortDir === 'asc' ? 'asc' : 'desc';
    switch (sortBy) {
      case 'leadNumber':
        return { leadNumber: dir };
      case 'title':
        return { title: dir };
      case 'stage':
        return { stage: dir };
      case 'value':
        return { value: dir };
      case 'score':
        return { score: dir };
      case 'updatedAt':
        return { updatedAt: dir };
      case 'createdAt':
      default:
        return { createdAt: dir };
    }
  }
}
