/**
 * Product master sync - the guards.
 *
 * A sync that is wrong is far more expensive than one that is late: a truncated export would retire
 * thousands of products in one transaction, and every sales rep would notice before the operator did.
 * So the engine checks the shape of the file against what it expects before it writes anything, and
 * a failed guard blocks the apply unless an admin overrides it with a reason that is kept on the run.
 *
 * Thresholds are environment-configurable with defaults chosen from the 28 Sep 2026 export: a
 * genuine refresh changes about 3-4% of the catalogue, so 90% kept and 5% removed per business unit
 * leave room for a real change and none for a broken one.
 */

import type { SyncCounts } from './diff';

export interface GuardResult {
  name: string;
  ok: boolean;
  /** fail blocks the apply; warn is shown and recorded but does not block. */
  severity: 'fail' | 'warn';
  detail: string;
}

export interface GuardThresholds {
  /** Kept rows must be at least this share of the previous run's kept rows (or of the active count). */
  minKeptRatio: number;
  /** Retirements per business group must not exceed this share of its active products. */
  maxRetireRatio: number;
  /** The DCHAIN statuses the business agreed the report is filtered to. */
  expectedDchain: string[];
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function guardThresholdsFromEnv(): GuardThresholds {
  const dchain = (process.env.PRODUCT_SYNC_EXPECTED_DCHAIN ?? 'Y5,Y6,Y7,Y9')
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return {
    minKeptRatio: envNumber('PRODUCT_SYNC_MIN_KEPT_RATIO', 0.9),
    maxRetireRatio: envNumber('PRODUCT_SYNC_MAX_RETIRE_RATIO', 0.05),
    expectedDchain: dchain,
  };
}

/** "DCHAIN is Y5, Y6, Y7, or Y9" -> ["Y5","Y6","Y7","Y9"]. */
export function dchainCodesFromFilter(filter: string): string[] {
  return [...new Set((filter.toUpperCase().match(/\bY\d\b/g) ?? []))].sort();
}

export interface GuardInput {
  counts: SyncCounts;
  appliedFilter?: string;
  /** Kept rows of the last applied full-snapshot run, when there has been one. */
  previousKept?: number;
  thresholds?: GuardThresholds;
}

export function evaluateGuards(input: GuardInput): GuardResult[] {
  const { counts, appliedFilter } = input;
  const t = input.thresholds ?? guardThresholdsFromEnv();
  const results: GuardResult[] = [];
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  const groups = ['CDG', 'LSG'];
  const missing = groups.filter((g) => (counts.perBusinessGroup[g]?.kept ?? 0) === 0);
  results.push({
    name: 'business-units-present',
    ok: missing.length === 0,
    severity: 'fail',
    detail:
      missing.length === 0
        ? groups.map((g) => `${g}: ${counts.perBusinessGroup[g]?.kept ?? 0} rows`).join(', ')
        : `No rows for ${missing.join(' and ')} - a full export always carries both business units`,
  });

  const activeBefore = Object.values(counts.perBusinessGroup).reduce((n, g) => n + g.activeBefore, 0);
  const baseline = input.previousKept ?? activeBefore;
  const baselineLabel = input.previousKept !== undefined ? 'the last applied run' : 'the active catalogue';
  const ratio = baseline > 0 ? counts.kept / baseline : 1;
  results.push({
    name: 'kept-rows',
    ok: ratio >= t.minKeptRatio,
    severity: 'fail',
    detail: `${counts.kept.toLocaleString()} rows kept = ${pct(ratio)} of ${baselineLabel} (${baseline.toLocaleString()}); minimum ${pct(t.minKeptRatio)}`,
  });

  for (const g of groups) {
    const c = counts.perBusinessGroup[g];
    if (!c || c.kept === 0) continue;
    const share = c.activeBefore > 0 ? c.retire / c.activeBefore : 0;
    results.push({
      name: `retire-share-${g}`,
      ok: share <= t.maxRetireRatio,
      severity: 'fail',
      detail: `${g}: ${c.retire.toLocaleString()} of ${c.activeBefore.toLocaleString()} active products would be removed (${pct(share)}); maximum ${pct(t.maxRetireRatio)}`,
    });
  }

  if (appliedFilter) {
    const found = dchainCodesFromFilter(appliedFilter);
    const expected = [...t.expectedDchain].sort();
    const same = found.length === expected.length && found.every((v, i) => v === expected[i]);
    results.push({
      name: 'applied-filter',
      ok: same,
      severity: 'fail',
      detail: same
        ? `Report filter is the agreed one (${expected.join(', ')})`
        : `Report filter "${appliedFilter}" is not the agreed ${expected.join(', ')}`,
    });
  } else {
    results.push({
      name: 'applied-filter',
      ok: true,
      severity: 'warn',
      detail: 'File carries no "Applied filters" footer, so the report filter could not be checked',
    });
  }

  if (counts.invalid > 0) {
    results.push({
      name: 'invalid-rows',
      ok: true,
      severity: 'warn',
      detail: `${counts.invalid.toLocaleString()} row(s) failed validation; they are left out, and the products they point at are left alone`,
    });
  }
  if (counts.manualRetire > 0) {
    results.push({
      name: 'hand-made-removed',
      ok: true,
      severity: 'warn',
      detail: `${counts.manualRetire.toLocaleString()} product(s) created in the app are not in the master, so they are removed with the rest`,
    });
  }
  if (counts.held > 0) {
    results.push({
      name: 'held-codes',
      ok: true,
      severity: 'warn',
      detail: `${counts.held.toLocaleString()} code(s) held back (collision in the file or ambiguous match); nothing is written for them`,
    });
  }

  return results;
}

export function guardsBlockApply(guards: GuardResult[]): boolean {
  return guards.some((g) => g.severity === 'fail' && !g.ok);
}
