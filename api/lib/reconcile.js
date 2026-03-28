'use strict';
// Field policy registry — defines canonical source, fallback, and conflict rules
// for each field type. Source keys are lowercase provider names.

const FIELD_POLICY = {
  price: {
    priority:     { fmp: 10, yahoo: 9, computed: 5 },
    tolerancePct: 0.005,   // 0.5% — prices should match closely
    staleMs:      900000,  // 15 minutes
    label:        'Live Price',
    basis:        'live',
  },
  eps: {
    priority:     { fmp: 10, edgar: 9, computed: 5 },
    tolerancePct: 0.05,    // 5%
    staleMs:      86400000 * 90, // 90 days
    label:        'EPS (TTM)',
    basis:        'TTM',
  },
  revenue: {
    priority:     { fmp: 10, edgar: 9, computed: 5 },
    tolerancePct: 0.02,
    staleMs:      86400000 * 90,
    label:        'Revenue',
    basis:        'TTM',
  },
  marketCap: {
    priority:     { computed: 10, fmp: 8 },
    tolerancePct: 0.01,
    staleMs:      900000,
    label:        'Market Cap',
    basis:        'live',
  },
  pe: {
    priority:     { computed: 10, fmp: 6 },
    tolerancePct: 0.05,
    staleMs:      900000,
    label:        'P/E',
    basis:        'TTM',
  },
  cpi: {
    priority:     { fred: 10, bls: 9 },
    tolerancePct: 0.001,
    staleMs:      86400000 * 45, // 45 days (monthly release)
    label:        'CPI YoY',
    basis:        'latest_release',
  },
  fedFunds: {
    priority:     { fred: 10, fed: 9 },
    tolerancePct: 0.0001,
    staleMs:      86400000 * 2,
    label:        'Fed Funds Rate',
    basis:        'target_range',
  },
  treasury10y: {
    priority:     { fred: 10, yahoo: 8 },
    tolerancePct: 0.005,
    staleMs:      3600000, // 1 hour
    label:        '10Y Treasury',
    basis:        'latest_release',
  },
  expenseRatio: {
    priority:     { issuer: 10, sec_edgar: 9, fmp: 5, web: 2 },
    tolerancePct: 0.0001,
    staleMs:      86400000 * 30,
    label:        'Expense Ratio',
    basis:        'issuer_prospectus',
  },
  segmentRevenue: {
    priority:     { edgar: 10, fmp: 8, web: 2 },
    tolerancePct: 0.05,
    staleMs:      86400000 * 90,
    label:        'Segment Revenue',
    basis:        'filing',
  },
};

/**
 * checkVariance(fieldA, fieldB, tolerancePct) → { conflict: bool, pct: number|null, error: string|null }
 * Returns conflict:true if the two values differ by more than tolerancePct.
 */
function checkVariance(fieldA, fieldB, tolerancePct = 0.02) {
  const a = Number(fieldA?.value), b = Number(fieldB?.value);
  if (isNaN(a) || isNaN(b)) return { conflict: false, pct: null, error: 'Cannot compare non-numeric values' };
  if (a === 0 && b === 0)   return { conflict: false, pct: 0, error: null };
  if (a === 0)               return { conflict: Math.abs(b) > 1e-10, pct: null, error: 'fieldA is zero' };
  const pct = Math.abs((a - b) / Math.abs(a));
  return { conflict: pct > tolerancePct, pct, error: null };
}

/**
 * reconcileField(candidates[], fieldType) → best TrustField, marked conflicted if material variance found.
 * candidates: array of TrustField objects
 */
function reconcileField(candidates, fieldType) {
  const policy  = FIELD_POLICY[fieldType] || {};
  const priority = policy.priority || {};
  const tol      = policy.tolerancePct ?? 0.02;

  const valid = (candidates || []).filter(c => c?.ok && c?.value != null);
  if (!valid.length) return null;
  if (valid.length === 1) return valid[0];

  // Sort by source priority (higher score = more trusted)
  const score = (tf) => priority[tf.source?.toLowerCase()] ?? 0;
  const sorted = [...valid].sort((a, b) => score(b) - score(a));

  const best   = sorted[0];
  const second = sorted[1];
  const v = checkVariance(best, second, tol);

  if (v.conflict) {
    return {
      ...best,
      conflicted:    true,
      status:        'conflicted',
      confirmSource: second.source,
      note:          `Conflict: ${best.source}=${best.value} vs ${second.source}=${second.value} (${v.pct != null ? (v.pct*100).toFixed(1)+'%' : 'n/a'} diff)`,
      tolerancePct:  tol,
    };
  }
  return { ...best, confirmSource: second.source, status: 'confirmed', tolerancePct: tol };
}

module.exports = { FIELD_POLICY, checkVariance, reconcileField };
