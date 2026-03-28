'use strict';
const assert = require('assert');
const { field, nullField } = require('../../api/lib/trust');
const { computePE, computeMarketCap, computeEV, computeEvEbitda, computeMargin, computeGrowth, computeNetDebt } = require('../../api/lib/metrics');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch(e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

console.log('\nMetric Engine tests\n');

// ── computePE ──────────────────────────────────────────────────────────────
test('computePE — happy path', () => {
  const price = field(227.52, { source: 'FMP', asOf: new Date().toISOString() });
  const eps   = field(6.43,   { source: 'FMP', valueType: 'TTM', periodEnd: '2024-09-30' });
  const pe = computePE(price, eps);
  assert.strictEqual(pe.ok, true);
  assert.ok(Math.abs(pe.value - 35.39) < 0.01, `Expected ~35.39, got ${pe.value}`);
  assert.strictEqual(pe.formula, 'price / eps');
  assert.strictEqual(pe.sourceType, 'derived');
  assert.strictEqual(pe.valueType, 'TTM');
});

test('computePE — zero EPS returns nullField', () => {
  const price = field(100, { source: 'FMP' });
  const eps   = field(0,   { source: 'FMP', valueType: 'TTM' });
  const pe = computePE(price, eps);
  assert.strictEqual(pe.ok, false);
  assert.ok(pe.note.includes('zero'), `Expected zero message, got: ${pe.note}`);
});

test('computePE — null price returns nullField', () => {
  const eps  = field(6.43, { source: 'FMP', valueType: 'TTM' });
  const pe   = computePE(nullField('FMP'), eps);
  assert.strictEqual(pe.ok, false);
});

test('computePE — null EPS returns nullField', () => {
  const price = field(200, { source: 'FMP' });
  const pe    = computePE(price, nullField('FMP'));
  assert.strictEqual(pe.ok, false);
});

test('computePE — stale price downgrades confidence', () => {
  const oldDate = new Date(Date.now() - 2 * 86400000).toISOString(); // 2 days ago
  const price = field(100, { source: 'FMP', asOf: oldDate });
  const eps   = field(5,   { source: 'FMP', valueType: 'TTM', periodEnd: '2024-09-30' });
  const pe = computePE(price, eps);
  assert.strictEqual(pe.ok, true);
  assert.notStrictEqual(pe.confidence, 'high');
});

test('computePE — negative EPS still computes (loss company)', () => {
  const price = field(50,  { source: 'FMP' });
  const eps   = field(-2,  { source: 'FMP', valueType: 'TTM' });
  const pe = computePE(price, eps);
  assert.strictEqual(pe.ok, true);
  assert.strictEqual(pe.value, -25);
});

// ── computeMarketCap ───────────────────────────────────────────────────────
test('computeMarketCap — AAPL-like values', () => {
  const price  = field(227.52,        { source: 'FMP' });
  const shares = field(15_550_000_000, { source: 'FMP' });
  const mc = computeMarketCap(price, shares);
  assert.strictEqual(mc.ok, true);
  const expectedB = 227.52 * 15.55; // ~3,538.9B
  assert.ok(Math.abs(mc.value / 1e9 - expectedB) < 1, `Expected ~$${expectedB.toFixed(0)}B`);
});

// ── computeEV ─────────────────────────────────────────────────────────────
test('computeEV — basic calculation', () => {
  const mc   = field(3_500_000_000_000, { source: 'computed' });
  const debt = field(100_000_000_000,   { source: 'FMP' });
  const cash = field(160_000_000_000,   { source: 'FMP' });
  const ev   = computeEV(mc, debt, cash);
  assert.strictEqual(ev.ok, true);
  assert.strictEqual(ev.value, 3_440_000_000_000);
  assert.strictEqual(ev.formula, 'marketCap + totalDebt - cash');
});

test('computeEV — missing debt/cash uses 0 fallback', () => {
  const mc = field(3_500_000_000_000, { source: 'computed' });
  const ev = computeEV(mc, nullField('FMP'), nullField('FMP'));
  assert.strictEqual(ev.ok, true);
  assert.strictEqual(ev.value, 3_500_000_000_000);
});

// ── computeMargin ─────────────────────────────────────────────────────────
test('computeMargin — gross margin 46%', () => {
  const gp  = field(180e9, { source: 'FMP', periodEnd: '2024-09-30' });
  const rev = field(391e9, { source: 'FMP', periodEnd: '2024-09-30' });
  const gm  = computeMargin(gp, rev, 'grossProfit');
  assert.strictEqual(gm.ok, true);
  assert.ok(Math.abs(gm.value - 0.4603) < 0.001, `Expected ~0.46, got ${gm.value}`);
});

test('computeMargin — zero revenue returns nullField', () => {
  const gp  = field(100e9, { source: 'FMP' });
  const rev = field(0,     { source: 'FMP' });
  const gm  = computeMargin(gp, rev, 'grossProfit');
  assert.strictEqual(gm.ok, false);
});

test('computeMargin — period mismatch downgrades confidence', () => {
  const gp  = field(180e9, { source: 'FMP', periodEnd: '2024-09-30' });
  const rev = field(391e9, { source: 'FMP', periodEnd: '2024-06-30' }); // different period
  const gm  = computeMargin(gp, rev, 'grossProfit');
  assert.strictEqual(gm.ok, true);
  assert.strictEqual(gm.confidence, 'medium');
});

// ── computeGrowth ──────────────────────────────────────────────────────────
test('computeGrowth — positive YoY growth', () => {
  const cur  = field(391e9, { source: 'FMP', periodEnd: '2024-09-30' });
  const prev = field(383e9, { source: 'FMP', periodEnd: '2023-09-30' });
  const g = computeGrowth(cur, prev);
  assert.strictEqual(g.ok, true);
  assert.ok(Math.abs(g.value - 0.02089) < 0.001, `Expected ~2.1%, got ${(g.value*100).toFixed(2)}%`);
});

test('computeGrowth — zero prior returns nullField', () => {
  const cur  = field(391e9, { source: 'FMP' });
  const prev = field(0,     { source: 'FMP' });
  const g = computeGrowth(cur, prev);
  assert.strictEqual(g.ok, false);
});

// ── computeNetDebt ─────────────────────────────────────────────────────────
test('computeNetDebt — net cash company (Apple-like)', () => {
  const debt = field(106e9, { source: 'FMP' });
  const cash = field(165e9, { source: 'FMP' });
  const nd = computeNetDebt(debt, cash);
  assert.strictEqual(nd.ok, true);
  assert.strictEqual(nd.value, -59e9); // net cash = negative net debt
});

test('computeNetDebt — net debt company', () => {
  const debt = field(200e9, { source: 'FMP' });
  const cash = field(50e9,  { source: 'FMP' });
  const nd = computeNetDebt(debt, cash);
  assert.strictEqual(nd.ok, true);
  assert.strictEqual(nd.value, 150e9);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
