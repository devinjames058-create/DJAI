'use strict';
// TrustField factory — wraps every canonical numeric field with provenance,
// staleness, and conflict metadata so all panels share the same truth signal.

const NOW = () => new Date().toISOString();

/**
 * field(value, opts) → TrustField
 * Create a TrustField for a known value.
 *
 * Required: opts.source  ('FMP' | 'FRED' | 'Yahoo' | 'EDGAR' | 'computed' | ...)
 * Optional:
 *   asOf          ISO timestamp when value was current
 *   periodEnd     Fiscal period end for fundamentals
 *   sourceType    'canonical' | 'derived' | 'research' | 'fallback'
 *   confidence    'high' | 'medium' | 'low'
 *   valueType     'live' | 'close' | 'TTM' | 'NTM' | 'LTM' | 'latest_release' | 'derived'
 *   basis         human-readable formula label, e.g. 'price / TTM_EPS'
 *   note          any warning or context string
 *   status        'confirmed' | 'unconfirmed' | 'conflicted' | 'stale' | 'unavailable' | 'cached'
 *   primarySource canonical provider name
 *   confirmSource confirming provider name
 *   tolerancePct  variance threshold used for conflict detection
 *   formula       symbolic formula string, e.g. 'price / eps'
 *   formattedValue pre-formatted display string (e.g. '$391.0B')
 *   stale         boolean — explicitly marked stale
 *   conflicted    boolean — conflict detected
 */
function field(value, opts = {}) {
  const n = Number(value);
  const ok = value != null && !Number.isNaN(n === n ? n : value) && value !== Infinity && value !== -Infinity;
  return {
    value,
    formattedValue:   opts.formattedValue  ?? null,
    source:           opts.source          ?? 'unknown',
    sourceType:       opts.sourceType      ?? 'canonical',
    asOf:             opts.asOf            ?? null,
    periodEnd:        opts.periodEnd       ?? null,
    retrievedAt:      NOW(),
    stale:            opts.stale           ?? false,
    conflicted:       opts.conflicted      ?? false,
    confidence:       opts.confidence      ?? (ok ? 'high' : 'low'),
    valueType:        opts.valueType       ?? null,
    basis:            opts.basis           ?? null,
    note:             opts.note            ?? null,
    status:           opts.status          ?? (ok ? 'confirmed' : 'unavailable'),
    primarySource:    opts.primarySource   ?? opts.source  ?? null,
    confirmSource:    opts.confirmSource   ?? null,
    tolerancePct:     opts.tolerancePct    ?? null,
    formula:          opts.formula         ?? null,
    ok,
  };
}

/** nullField(source, reason) → TrustField with ok:false and status:'unavailable' */
function nullField(source, reason) {
  return {
    value: null, formattedValue: null,
    source: source ?? 'unknown', sourceType: 'canonical',
    asOf: null, periodEnd: null, retrievedAt: NOW(),
    stale: false, conflicted: false, confidence: 'low',
    valueType: null, basis: null, note: reason ?? null,
    status: 'unavailable', primarySource: source ?? null,
    confirmSource: null, tolerancePct: null, formula: null, ok: false,
  };
}

/** isStale(tf, maxAgeMs) → bool */
function isStale(tf, maxAgeMs) {
  if (!tf?.retrievedAt) return false;
  return Date.now() - new Date(tf.retrievedAt).getTime() > maxAgeMs;
}

/** markStale(tf) → new TrustField with stale:true */
function markStale(tf) {
  return { ...tf, stale: true, status: 'stale' };
}

/** markConflicted(tf, note) → new TrustField with conflicted:true */
function markConflicted(tf, note) {
  return { ...tf, conflicted: true, status: 'conflicted', note };
}

module.exports = { field, nullField, isStale, markStale, markConflicted };
