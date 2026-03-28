'use strict';
const assert = require('assert');
const { field, nullField } = require('../../api/lib/trust');
const { checkVariance, reconcileField, FIELD_POLICY } = require('../../api/lib/reconcile');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch(e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

console.log('\nReconcile tests\n');

test('checkVariance — within tolerance (no conflict)', () => {
  const a = field(100, { source: 'FMP' });
  const b = field(100.3, { source: 'Yahoo' });
  const v = checkVariance(a, b, 0.01); // 1% tolerance
  assert.strictEqual(v.conflict, false);
  assert.ok(v.pct < 0.01);
});

test('checkVariance — outside tolerance (conflict)', () => {
  const a = field(100, { source: 'FMP' });
  const b = field(120, { source: 'Yahoo' });
  const v = checkVariance(a, b, 0.05); // 5% tolerance
  assert.strictEqual(v.conflict, true);
  assert.ok(v.pct > 0.05);
});

test('checkVariance — non-numeric fields return no conflict', () => {
  const a = field('abc', { source: 'FMP' });
  const b = field('xyz', { source: 'Yahoo' });
  const v = checkVariance(a, b, 0.05);
  assert.strictEqual(v.conflict, false);
  assert.ok(v.error);
});

test('reconcileField — single candidate returns it directly', () => {
  const a = field(100, { source: 'FMP' });
  const result = reconcileField([a], 'price');
  assert.strictEqual(result.value, 100);
  assert.strictEqual(result.source, 'FMP');
});

test('reconcileField — higher-priority source wins', () => {
  const fmp   = field(100, { source: 'FMP' });
  const yahoo = field(101, { source: 'Yahoo' });
  // For 'price', FMP priority=10, Yahoo priority=9
  const result = reconcileField([yahoo, fmp], 'price');
  assert.strictEqual(result.source, 'FMP');
});

test('reconcileField — conflict marked when variance > threshold', () => {
  const fmp   = field(100, { source: 'FMP' });
  const yahoo = field(115, { source: 'Yahoo' }); // 15% diff
  // price tolerance is 0.5% — should conflict
  const result = reconcileField([fmp, yahoo], 'price');
  assert.strictEqual(result.conflicted, true);
  assert.strictEqual(result.status, 'conflicted');
});

test('reconcileField — no conflict when within tolerance', () => {
  const fmp   = field(100.0, { source: 'FMP' });
  const yahoo = field(100.1, { source: 'Yahoo' }); // 0.1% diff
  const result = reconcileField([fmp, yahoo], 'price');
  assert.strictEqual(result.conflicted, false);
  assert.strictEqual(result.status, 'confirmed');
});

test('reconcileField — empty array returns null', () => {
  const result = reconcileField([], 'price');
  assert.strictEqual(result, null);
});

test('reconcileField — filters out nullFields', () => {
  const fmp  = field(100, { source: 'FMP' });
  const null_ = nullField('Yahoo');
  const result = reconcileField([null_, fmp], 'price');
  assert.strictEqual(result.value, 100);
  assert.strictEqual(result.source, 'FMP');
});

test('FIELD_POLICY contains all required fields', () => {
  const required = ['price', 'eps', 'revenue', 'marketCap', 'pe', 'cpi', 'fedFunds', 'treasury10y', 'expenseRatio', 'segmentRevenue'];
  for (const f of required) {
    assert.ok(FIELD_POLICY[f], `Missing policy for: ${f}`);
    assert.ok(FIELD_POLICY[f].priority, `Missing priority for: ${f}`);
    assert.ok(FIELD_POLICY[f].tolerancePct != null, `Missing tolerancePct for: ${f}`);
  }
});

test('FIELD_POLICY — research layer cannot override price canonical source', () => {
  // Verify that 'web' or 'research' sources have lower priority than canonical
  const pricePolicy = FIELD_POLICY['price'];
  const canonicalMin = Math.min(...Object.values(pricePolicy.priority));
  // Price policy has no 'web' key — research layer not a recognized source
  assert.ok(!pricePolicy.priority['web'], 'web source must not have price priority');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
