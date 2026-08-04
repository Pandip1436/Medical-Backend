/**
 * Stable relevance ordering for search results. Rows whose PRIMARY field(s)
 * (name / number) contain the query are moved ahead of rows that matched only
 * via a secondary field (address / notes / related invoice number / etc.).
 *
 * The input should already be sorted the way ties should break (by name or
 * date); Array.prototype.sort is stable, so that order is preserved within each
 * relevance tier. No-op when there's no query.
 *
 * Usage:
 *   rankByRelevance(rows, query, (r) => [r.name])            // suppliers/customers
 *   rankByRelevance(rows, query, (r) => [r.debitNoteNo])     // primary = number
 *
 * Because ranking is global, callers with pagination must fetch the full match
 * set, rank, then slice the requested page — the same approach the suppliers
 * endpoint uses. Search result sets are small, so this is cheap in practice.
 */
export function rankByRelevance<T>(
  rows: T[],
  query: string | undefined,
  primaryFieldsOf: (row: T) => Array<string | null | undefined>,
): T[] {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return rows;
  // Lower score = more relevant: 0 exact, 1 prefix (starts-with), 2 contains,
  // 3 matched only via a secondary field. So "Santhosh" (prefix) ranks above
  // "JayaSANTHi" (mid-word) for the query "santh". Stable sort keeps the
  // incoming order (usually name/date) as the tie-break within a tier.
  const score = (r: T): number => {
    let best = 3;
    for (const raw of primaryFieldsOf(r)) {
      const v = (raw ?? '').toLowerCase();
      if (!v) continue;
      if (v === q) return 0;
      if (v.startsWith(q)) best = Math.min(best, 1);
      else if (v.includes(q)) best = Math.min(best, 2);
    }
    return best;
  };
  return [...rows].sort((a, b) => score(a) - score(b));
}
