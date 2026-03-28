'use strict';
// Plain Node.js tests — run with: node tests/unit/trust.test.js
const assert = require('assert');
const { field, nullField, isStale, markStale, markConflicted } = require('../../api/lib/trust');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch(e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

console.log('\nTrustField tests\n');

test('field() sets ok:true for valid number', () => {
  const f = field(42, { source: 'FMP' });
  assert.strictEqual(f.ok, true);
  assert.strictEqual(f.value, 42);
  assert.strictEqual(f.source, 'FMP');
  assert.strictEqual(f.status, 'confirmed');
});

test('field() sets ok:false for null value', () => {
  const f = field(null, { source: 'FMP' });
  assert.strictEqual(f.ok, false);
});

test('field() sets ok:false for Infinity', () => {
  const f = field(Infinity, { source: 'computed' });
  assert.strictEqual(f.ok, false);
});

test('field() sets ok:false for NaN', () => {
  const f = field(NaN, { source: 'computed' });
  assert.strictEqual(f.ok, false);
});

test('nullField() returns ok:false with status unavailable', () => {
  const f = nullField('FMP', 'API error');
  assert.strictEqual(f.ok, false);
  assert.strictEqual(f.status, 'unavailable');
  assert.strictEqual(f.note, 'API error');
  assert.strictEqual(f.value, null);
});

test('isStale() returns false for fresh field', () => {
  const f = field(100, { source: 'FMP' });
  assert.strictEqual(isStale(f, 60000), false); // 1 min threshold, just created
});

test('isStale() returns true for artificially old field', () => {
  const f = { ...field(100, { source: 'FMP' }), retrievedAt: new Date(Date.now() - 3600000).toISOString() };
  assert.strictEqual(isStale(f, 60000), true); // 1 min threshold, 1 hour old
});

test('markStale() returns new field with stale:true', () => {
  const f = field(100, { source: 'FMP' });
  const s = markStale(f);
  assert.strictEqual(s.stale, true);
  assert.strictEqual(s.status, 'stale');
  assert.strictEqual(f.stale, false); // original unchanged
});

test('markConflicted() returns new field with conflicted:true', () => {
  const f = field(100, { source: 'FMP' });
  const c = markConflicted(f, 'Test conflict');
  assert.strictEqual(c.conflicted, true);
  assert.strictEqual(c.status, 'conflicted');
  assert.strictEqual(c.note, 'Test conflict');
});

test('field() stores all metadata correctly', () => {
  const f = field(391e9, {
    source: 'FMP', sourceType: 'canonical', valueType: 'TTM',
    periodEnd: '2024-09-30', asOf: '2024-03-15',
    basis: 'annual income statement', confidence: 'high',
  });
  assert.strictEqual(f.sourceType, 'canonical');
  assert.strictEqual(f.valueType, 'TTM');
  assert.strictEqual(f.periodEnd, '2024-09-30');
  assert.strictEqual(f.confidence, 'high');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
