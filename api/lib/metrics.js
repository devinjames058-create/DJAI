'use strict';
const { field, nullField } = require('./trust');

function _safe(v) {
  const n = Number(v);
  return (isNaN(n) || !isFinite(n)) ? null : n;
}

/** computePE(price, eps) → TrustField */
function computePE(price, eps) {
  const p = _safe(price?.value), e = _safe(eps?.value);
  if (p == null || !price?.ok) return nullField('metrics', 'price unavailable');
  if (e == null || !eps?.ok)   return nullField('metrics', 'EPS unavailable');
  if (e === 0)                  return nullField('metrics', 'EPS is zero — P/E undefined');
  const value = p / e;
  if (!isFinite(value))         return nullField('metrics', 'P/E is not finite');

  const priceAgeMs  = price.asOf   ? Date.now() - new Date(price.asOf).getTime()   : null;
  const epsAgeYears = eps.periodEnd ? (Date.now() - new Date(eps.periodEnd).getTime()) / 3.156e10 : null;
  let confidence = 'high', note = null;
  if (priceAgeMs  != null && priceAgeMs  > 86400000) { confidence = 'medium'; note = 'Price > 1 day old'; }
  if (epsAgeYears != null && epsAgeYears > 1.5)       { confidence = 'low';    note = 'EPS data > 18 months old'; }

  const vt = eps.valueType ?? 'TTM';
  return field(value, {
    source: `${price.source}/${eps.source}`, sourceType: 'derived',
    valueType: vt, basis: `price(${p.toFixed(2)}) / ${vt}_EPS(${e.toFixed(2)})`,
    formula: 'price / eps', asOf: price.asOf, periodEnd: eps.periodEnd,
    confidence, note, status: 'confirmed',
    primarySource: price.source, confirmSource: eps.source,
  });
}

/** computeMarketCap(price, sharesRaw) → TrustField (value in raw dollars) */
function computeMarketCap(price, sharesRaw) {
  const p = _safe(price?.value), s = _safe(sharesRaw?.value);
  if (p == null || !price?.ok)    return nullField('metrics', 'price unavailable');
  if (s == null || !sharesRaw?.ok) return nullField('metrics', 'shares unavailable');
  const value = p * s;
  if (!isFinite(value)) return nullField('metrics', 'market cap is not finite');
  return field(value, {
    source: `${price.source}/${sharesRaw.source}`, sourceType: 'derived',
    valueType: 'live', basis: `price(${p}) × shares(${s})`,
    formula: 'price × sharesRaw', asOf: price.asOf,
    confidence: price.confidence, status: 'confirmed',
    primarySource: price.source, confirmSource: sharesRaw.source,
  });
}

/** computeEV(marketCap, totalDebt, cash) → TrustField (same units as inputs) */
function computeEV(marketCap, totalDebt, cash) {
  const mc = _safe(marketCap?.value);
  if (mc == null || !marketCap?.ok) return nullField('metrics', 'market cap unavailable');
  const d = _safe(totalDebt?.value) ?? 0;
  const c = _safe(cash?.value) ?? 0;
  const value = mc + d - c;
  if (!isFinite(value)) return nullField('metrics', 'EV is not finite');
  return field(value, {
    source: marketCap.source, sourceType: 'derived',
    valueType: 'derived', basis: 'marketCap + totalDebt − cash',
    formula: 'marketCap + totalDebt - cash', asOf: marketCap.asOf,
    confidence: marketCap.confidence, status: 'confirmed',
  });
}

/** computeEvEbitda(ev, ebitda) → TrustField */
function computeEvEbitda(ev, ebitda) {
  const e = _safe(ev?.value), b = _safe(ebitda?.value);
  if (e == null || !ev?.ok)      return nullField('metrics', 'EV unavailable');
  if (b == null || !ebitda?.ok)  return nullField('metrics', 'EBITDA unavailable');
  if (b === 0)                    return nullField('metrics', 'EBITDA is zero');
  const value = e / b;
  if (!isFinite(value)) return nullField('metrics', 'EV/EBITDA is not finite');
  const vt = ebitda.valueType ?? 'TTM';
  const periodMatch = ev.asOf && ebitda.periodEnd;
  return field(value, {
    source: `${ev.source}/${ebitda.source}`, sourceType: 'derived',
    valueType: vt, basis: `EV / ${vt}_EBITDA`,
    formula: 'ev / ebitda', asOf: ev.asOf, periodEnd: ebitda.periodEnd,
    confidence: periodMatch ? 'high' : 'medium',
    note: periodMatch ? null : 'EV and EBITDA period alignment unverified',
    status: 'confirmed',
  });
}

/**
 * computeMargin(numerator, denominator, label) → TrustField (value 0-1, e.g. 0.456 = 45.6%)
 */
function computeMargin(numerator, denominator, label) {
  const n = _safe(numerator?.value), d = _safe(denominator?.value);
  if (n == null || !numerator?.ok)   return nullField('metrics', `${label} numerator unavailable`);
  if (d == null || !denominator?.ok) return nullField('metrics', `${label} denominator unavailable`);
  if (d === 0)                        return nullField('metrics', `${label} denominator is zero`);
  const value = n / d;
  if (!isFinite(value)) return nullField('metrics', `${label} margin is not finite`);
  const periodMatch = numerator.periodEnd === denominator.periodEnd;
  return field(value, {
    source: denominator.source, sourceType: 'derived',
    valueType: denominator.valueType ?? 'TTM',
    basis: `${label} / revenue`, formula: `${label} / revenue`,
    asOf: denominator.asOf, periodEnd: denominator.periodEnd,
    confidence: periodMatch ? 'high' : 'medium',
    note: periodMatch ? null : 'Period mismatch between numerator and denominator',
    status: 'confirmed',
  });
}

/**
 * computeGrowth(current, prior) → TrustField (value as decimal, e.g. 0.082 = +8.2%)
 */
function computeGrowth(current, prior) {
  const c = _safe(current?.value), p = _safe(prior?.value);
  if (c == null || !current?.ok) return nullField('metrics', 'current period unavailable');
  if (p == null || !prior?.ok)   return nullField('metrics', 'prior period unavailable');
  if (p === 0)                    return nullField('metrics', 'prior period value is zero');
  const value = (c - p) / Math.abs(p);
  if (!isFinite(value)) return nullField('metrics', 'growth rate is not finite');
  return field(value, {
    source: current.source, sourceType: 'derived',
    valueType: 'YoY', basis: '(current − prior) / |prior|',
    formula: '(current - prior) / abs(prior)',
    asOf: current.asOf, periodEnd: current.periodEnd,
    confidence: 'high', status: 'confirmed',
  });
}

/**
 * computeNetDebt(totalDebt, cash) → TrustField
 * Positive = net debt, negative = net cash.
 */
function computeNetDebt(totalDebt, cash) {
  const d = _safe(totalDebt?.value), c = _safe(cash?.value);
  const bothOk = totalDebt?.ok && cash?.ok;
  const value = (d ?? 0) - (c ?? 0);
  return field(value, {
    source: totalDebt?.source ?? cash?.source ?? 'unknown', sourceType: 'derived',
    valueType: 'latest', basis: 'totalDebt − cash',
    formula: 'totalDebt - cash',
    periodEnd: totalDebt?.periodEnd ?? cash?.periodEnd ?? null,
    confidence: bothOk ? 'high' : 'medium',
    note: bothOk ? null : 'One or more components unavailable — using 0 as fallback',
    status: 'confirmed',
  });
}

module.exports = { computePE, computeMarketCap, computeEV, computeEvEbitda, computeMargin, computeGrowth, computeNetDebt };
