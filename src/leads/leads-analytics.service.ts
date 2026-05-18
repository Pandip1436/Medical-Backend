import { Injectable } from '@nestjs/common';
import {
  Prisma,
  LeadStage,
  LeadStatus,
  LeadSource,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Analytics is read-only and aggregation-heavy. Kept in its own service so the
// hot path (LeadsService.findMany / patch / counts) stays uncluttered.
@Injectable()
export class LeadsAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Build the branch scope clause shared by every analytics query. */
  private branchScope(branchId?: string): Prisma.LeadWhereInput {
    return branchId ? { branchId } : {};
  }

  /** Period window with safe defaults. Used by summary + trend. */
  private periodWindow(from?: string, to?: string) {
    const toDate = to ? new Date(to) : new Date();
    toDate.setHours(23, 59, 59, 999);
    const fromDate = from
      ? new Date(from)
      : new Date(toDate.getTime() - 30 * 86_400_000);
    fromDate.setHours(0, 0, 0, 0);
    return { fromDate, toDate };
  }

  /**
   * Summary endpoint — one round trip for KPIs, funnel, source breakdown,
   * aging buckets, and top cities. All aggregations run in parallel.
   *
   * Conventions:
   * - "Created in period" filters by `createdAt`.
   * - "Closed in period" filters by `updatedAt` AND `status='CLOSED'` — we
   *   don't have a dedicated `closedAt` column, so updatedAt is the proxy.
   * - Pipeline value sums `value` across ALL open leads (not period-scoped) —
   *   pipeline is a snapshot, not a window.
   */
  async getSummary(params: {
    from?: string;
    to?: string;
    branchId?: string;
  }) {
    const { fromDate, toDate } = this.periodWindow(params.from, params.to);
    const prevWindowMs = toDate.getTime() - fromDate.getTime();
    const prevFrom = new Date(fromDate.getTime() - prevWindowMs);
    const prevTo = new Date(fromDate.getTime() - 1);

    const branch = this.branchScope(params.branchId);
    const createdInPeriod: Prisma.LeadWhereInput = {
      ...branch,
      createdAt: { gte: fromDate, lte: toDate },
    };
    const createdInPrev: Prisma.LeadWhereInput = {
      ...branch,
      createdAt: { gte: prevFrom, lte: prevTo },
    };
    const closedInPeriod: Prisma.LeadWhereInput = {
      ...branch,
      status: LeadStatus.CLOSED,
      updatedAt: { gte: fromDate, lte: toDate },
    };

    const [
      totalCreated,
      totalCreatedPrev,
      openCount,
      pipelineValue,
      wonInPeriod,
      lostInPeriod,
      avgWonDeal,
      funnelGroups,
      sourceGroups,
      sourceWonGroups,
      stageBuckets,
    ] = await Promise.all([
      this.prisma.lead.count({ where: createdInPeriod }),
      this.prisma.lead.count({ where: createdInPrev }),
      this.prisma.lead.count({ where: { ...branch, status: LeadStatus.OPEN } }),
      this.prisma.lead.aggregate({
        where: { ...branch, status: LeadStatus.OPEN },
        _sum: { value: true },
      }),
      this.prisma.lead.aggregate({
        where: { ...closedInPeriod, stage: LeadStage.WON },
        _count: { _all: true },
        _sum: { value: true },
      }),
      this.prisma.lead.count({
        where: { ...closedInPeriod, stage: LeadStage.LOST },
      }),
      this.prisma.lead.aggregate({
        where: { ...closedInPeriod, stage: LeadStage.WON },
        _avg: { value: true },
      }),
      // Funnel: count of leads CURRENTLY at each stage, scoped to period for
      // "created" cohort. This shows the funnel for leads acquired in window.
      this.prisma.lead.groupBy({
        by: ['stage'],
        where: createdInPeriod,
        _count: { _all: true },
      }),
      // Source breakdown: counts per source for leads created in period.
      this.prisma.lead.groupBy({
        by: ['source'],
        where: createdInPeriod,
        _count: { _all: true },
      }),
      // Source × WON breakdown to derive win rate per source.
      this.prisma.lead.groupBy({
        by: ['source'],
        where: { ...createdInPeriod, stage: LeadStage.WON },
        _count: { _all: true },
      }),
      // Aging: pull stage + age in days for OPEN leads, then bucket in JS.
      this.prisma.lead.findMany({
        where: { ...branch, status: LeadStatus.OPEN },
        select: { stage: true, updatedAt: true, createdAt: true },
      }),
    ]);

    const wonCount = wonInPeriod._count?._all ?? 0;
    const lostCount = lostInPeriod;
    const totalClosed = wonCount + lostCount;
    const winRate = totalClosed > 0 ? wonCount / totalClosed : 0;

    // Funnel: ensure every stage shows up even if zero.
    const stageOrder: LeadStage[] = [
      LeadStage.LEAD,
      LeadStage.QUALIFIED,
      LeadStage.PROPOSAL,
      LeadStage.NEGOTIATION,
      LeadStage.WON,
      LeadStage.LOST,
    ];
    const stageMap = Object.fromEntries(
      funnelGroups.map((r) => [r.stage, r._count._all]),
    ) as Record<LeadStage, number>;
    const funnel = stageOrder.map((stage) => ({
      stage,
      count: stageMap[stage] ?? 0,
    }));

    // Source breakdown: bring win rate alongside the raw counts.
    const sourceWonMap = Object.fromEntries(
      sourceWonGroups.map((r) => [r.source, r._count._all]),
    ) as Record<LeadSource, number>;
    const sourceBreakdown = sourceGroups
      .map((r) => ({
        source: r.source,
        count: r._count._all,
        won: sourceWonMap[r.source] ?? 0,
        winRate:
          r._count._all > 0
            ? (sourceWonMap[r.source] ?? 0) / r._count._all
            : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // Aging buckets — measured from createdAt so we surface stuck leads
    // regardless of whether they've been touched recently.
    const now = Date.now();
    const buckets = ['0-7d', '7-30d', '30-90d', '90d+'] as const;
    const agingStages: LeadStage[] = [
      LeadStage.LEAD,
      LeadStage.QUALIFIED,
      LeadStage.PROPOSAL,
      LeadStage.NEGOTIATION,
    ];
    const aging = agingStages.map((stage) => {
      const counts: Record<(typeof buckets)[number], number> = {
        '0-7d': 0,
        '7-30d': 0,
        '30-90d': 0,
        '90d+': 0,
      };
      stageBuckets
        .filter((l) => l.stage === stage)
        .forEach((l) => {
          const ageDays = (now - new Date(l.createdAt).getTime()) / 86_400_000;
          if (ageDays < 7) counts['0-7d']++;
          else if (ageDays < 30) counts['7-30d']++;
          else if (ageDays < 90) counts['30-90d']++;
          else counts['90d+']++;
        });
      return { stage, ...counts };
    });

    return {
      period: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
      },
      kpis: {
        totalLeads: totalCreated,
        totalLeadsPrev: totalCreatedPrev,
        totalLeadsDelta:
          totalCreatedPrev > 0
            ? (totalCreated - totalCreatedPrev) / totalCreatedPrev
            : null,
        pipelineValue: Number(pipelineValue._sum?.value ?? 0),
        openLeads: openCount,
        winRate,
        wonCount,
        lostCount,
        avgDealSize: Number(avgWonDeal._avg?.value ?? 0),
      },
      funnel,
      sourceBreakdown,
      aging,
    };
  }

  /**
   * Time-series for the trend chart. Buckets leads created and leads won by
   * day (default) or month. Both series share the same x-axis.
   */
  async getTrend(params: {
    from?: string;
    to?: string;
    branchId?: string;
    bucket?: 'day' | 'month';
  }) {
    const { fromDate, toDate } = this.periodWindow(params.from, params.to);
    const bucket = params.bucket ?? 'day';
    const branch = this.branchScope(params.branchId);

    // Pull minimal columns; bucket in JS — keeps things portable and the
    // dataset is small (period × leads). For multi-year ranges, switch to
    // SQL `date_trunc` if perf becomes an issue.
    const [created, won] = await Promise.all([
      this.prisma.lead.findMany({
        where: { ...branch, createdAt: { gte: fromDate, lte: toDate } },
        select: { createdAt: true },
      }),
      this.prisma.lead.findMany({
        where: {
          ...branch,
          stage: LeadStage.WON,
          updatedAt: { gte: fromDate, lte: toDate },
        },
        select: { updatedAt: true },
      }),
    ]);

    const keyFor = (d: Date) => {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      if (bucket === 'month') return `${y}-${m}`;
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const map: Record<string, { created: number; won: number }> = {};
    // Pre-seed every bucket in range so the chart has continuous x-axis.
    const cursor = new Date(fromDate);
    while (cursor <= toDate) {
      map[keyFor(cursor)] = { created: 0, won: 0 };
      if (bucket === 'day') {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      } else {
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
    }
    for (const l of created) {
      const k = keyFor(new Date(l.createdAt));
      if (map[k]) map[k].created++;
    }
    for (const l of won) {
      const k = keyFor(new Date(l.updatedAt));
      if (map[k]) map[k].won++;
    }

    return {
      bucket,
      series: Object.entries(map)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, v]) => ({ key, created: v.created, won: v.won })),
    };
  }

  /**
   * Needs-attention list: OPEN leads with no activity in the last N days,
   * highest value first. Activity = either a LeadActivity row OR a manual
   * update to the lead within the window.
   */
  async getNeedsAttention(params: {
    branchId?: string;
    staleDays?: number;
    limit?: number;
  }) {
    const staleDays = Math.max(1, params.staleDays ?? 7);
    const limit = Math.min(50, Math.max(1, params.limit ?? 10));
    const cutoff = new Date(Date.now() - staleDays * 86_400_000);
    const branch = this.branchScope(params.branchId);

    // Leads with no activity since cutoff AND no own update since cutoff.
    const leads = await this.prisma.lead.findMany({
      where: {
        ...branch,
        status: LeadStatus.OPEN,
        updatedAt: { lt: cutoff },
        activities: {
          none: { createdAt: { gte: cutoff } },
        },
      },
      orderBy: [{ value: 'desc' }, { updatedAt: 'asc' }],
      take: limit,
      select: {
        id: true,
        leadNumber: true,
        title: true,
        stage: true,
        value: true,
        currency: true,
        updatedAt: true,
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
        assignedToUser: { select: { id: true, name: true } },
      },
    });

    return {
      staleDays,
      total: leads.length,
      leads: leads.map((l) => ({
        ...l,
        value: Number(l.value),
        daysSinceUpdate: Math.floor(
          (Date.now() - new Date(l.updatedAt).getTime()) / 86_400_000,
        ),
      })),
    };
  }
}
