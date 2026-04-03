'use strict';
const assert = require('assert');
const { _test } = require('../../api/financials');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch(e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

console.log('\nFinancials tests\n');

// ── _extractInstant (balance sheet / point-in-time facts) ─────────────────────

test('_extractInstant: keeps BS fact with null fp from annual form', () => {
  const facts = {
    facts: { 'us-gaap': {
      Assets: { units: { USD: [
        { form: '10-K', fy: 2024, end: '2024-12-31', filed: '2025-02-01', val: 1000 },
      ] } },
    } },
  };
  const result = _test._extractInstant(facts, ['Assets']);
  assert.strictEqual(result[2024].val, 1000);
});

test('_extractInstant: keeps BS fact with fp=FY from annual form', () => {
  const facts = {
    facts: { 'us-gaap': {
      Assets: { units: { USD: [
        { form: '10-K', fy: 2024, fp: 'FY', end: '2024-12-31', filed: '2025-02-01', val: 2000 },
      ] } },
    } },
  };
  const result = _test._extractInstant(facts, ['Assets']);
  assert.strictEqual(result[2024].val, 2000);
});

test('_extractInstant: rejects BS fact with fp=Q4 (explicit quarter)', () => {
  const facts = {
    facts: { 'us-gaap': {
      Assets: { units: { USD: [
        { form: '10-K', fy: 2024, fp: 'Q4', end: '2024-12-31', filed: '2025-02-01', val: 500 },
      ] } },
    } },
  };
  const result = _test._extractInstant(facts, ['Assets']);
  assert.strictEqual(result[2024], undefined);
});

// Regression: instant outstanding shares used for BVPS
test('_extractInstant: instant shares (isShares=true) with null fp from annual form', () => {
  const facts = {
    facts: { 'us-gaap': {
      CommonStockSharesOutstanding: { units: { shares: [
        { form: '10-K', fy: 2024, end: '2024-12-31', filed: '2025-02-01', val: 1e9 },
      ] } },
    } },
  };
  const result = _test._extractInstant(
    facts,
    ['CommonStockSharesOutstanding'],
    { isShares: true }
  );
  assert.strictEqual(result[2024].val, 1e9);
});

// ── _extractDuration (income statement / cash flow facts) ─────────────────────

test('_extractDuration: keeps fp=FY revenue from annual form', () => {
  const facts = {
    facts: { 'us-gaap': {
      Revenues: { units: { USD: [
        { form: '10-K', fy: 2024, fp: 'FY', start: '2024-01-01', end: '2024-12-31', filed: '2025-02-01', val: 1000 },
      ] } },
    } },
  };
  const result = _test._extractDuration(facts, ['Revenues']);
  assert.strictEqual(result[2024].val, 1000);
});

test('_extractDuration: excludes Q4 duration fact (quarterly data leakage)', () => {
  const facts = {
    facts: { 'us-gaap': {
      Revenues: { units: { USD: [
        { form: '10-K', fy: 2024, fp: 'Q4', start: '2024-10-01', end: '2024-12-31', filed: '2025-02-01', val: 250 },
        { form: '10-K', fy: 2024, fp: 'FY', start: '2024-01-01', end: '2024-12-31', filed: '2025-02-01', val: 1000 },
      ] } },
    } },
  };
  const result = _test._extractDuration(facts, ['Revenues']);
  assert.strictEqual(result[2024].val, 1000);
});

test('_extractDuration: accepts null fp when period spans ~12 months (filer omits fp)', () => {
  const facts = {
    facts: { 'us-gaap': {
      Revenues: { units: { USD: [
        { form: '10-K', fy: 2024, fp: null, start: '2024-01-01', end: '2024-12-31', filed: '2025-02-01', val: 800 },
      ] } },
    } },
  };
  const result = _test._extractDuration(facts, ['Revenues']);
  assert.strictEqual(result[2024].val, 800);
});

test('_extractDuration: rejects null fp when period is only one quarter (~91 days)', () => {
  const facts = {
    facts: { 'us-gaap': {
      Revenues: { units: { USD: [
        { form: '10-K', fy: 2024, fp: null, start: '2024-10-01', end: '2024-12-31', filed: '2025-02-01', val: 250 },
      ] } },
    } },
  };
  const result = _test._extractDuration(facts, ['Revenues']);
  assert.strictEqual(result[2024], undefined);
});

// Regression: diluted weighted-average shares on IS side
test('_extractDuration: diluted shares (isShares=true) from annual form', () => {
  const facts = {
    facts: { 'us-gaap': {
      WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: [
        { form: '10-K', fy: 2024, fp: 'FY', start: '2024-01-01', end: '2024-12-31', filed: '2025-02-01', val: 5e9 },
      ] } },
    } },
  };
  const result = _test._extractDuration(
    facts,
    ['WeightedAverageNumberOfDilutedSharesOutstanding'],
    { isShares: true }
  );
  assert.strictEqual(result[2024].val, 5e9);
});

// ── Dedup / form priority ──────────────────────────────────────────────────────

test('_extractDuration: prefers original 10-K over 10-K/A when filed date is identical', () => {
  const facts = {
    facts: { 'us-gaap': {
      Revenues: { units: { USD: [
        // Amendment filed same day — original should win
        { form: '10-K/A', fy: 2024, fp: 'FY', start: '2024-01-01', end: '2024-12-31', filed: '2025-03-15', val: 900 },
        { form: '10-K',   fy: 2024, fp: 'FY', start: '2024-01-01', end: '2024-12-31', filed: '2025-03-15', val: 950 },
      ] } },
    } },
  };
  const result = _test._extractDuration(facts, ['Revenues']);
  assert.strictEqual(result[2024].val, 950);
});

test('_extractDuration: later-filed 10-K/A still wins over earlier 10-K', () => {
  const facts = {
    facts: { 'us-gaap': {
      Revenues: { units: { USD: [
        { form: '10-K',   fy: 2024, fp: 'FY', start: '2024-01-01', end: '2024-12-31', filed: '2025-02-01', val: 950 },
        { form: '10-K/A', fy: 2024, fp: 'FY', start: '2024-01-01', end: '2024-12-31', filed: '2025-04-01', val: 960 },
      ] } },
    } },
  };
  const result = _test._extractDuration(facts, ['Revenues']);
  assert.strictEqual(result[2024].val, 960);
});

// ── _buildBS integration: BVPS computed from instant shares ───────────────────

test('_buildBS: bookValuePerShare = equity / instant outstanding shares', () => {
  const equity  = 10e9;  // $10B
  const shares  = 1e9;   // 1B shares
  const facts = {
    facts: { 'us-gaap': {
      Assets:                        { units: { USD:    [{ form: '10-K', fy: 2024, end: '2024-12-31', filed: '2025-02-01', val: 20e9 }] } },
      Liabilities:                   { units: { USD:    [{ form: '10-K', fy: 2024, end: '2024-12-31', filed: '2025-02-01', val: 10e9 }] } },
      StockholdersEquity:            { units: { USD:    [{ form: '10-K', fy: 2024, end: '2024-12-31', filed: '2025-02-01', val: equity }] } },
      CommonStockSharesOutstanding:  { units: { shares: [{ form: '10-K', fy: 2024, end: '2024-12-31', filed: '2025-02-01', val: shares }] } },
    } },
  };
  const rows = _test._buildBS(facts, [2024]);
  assert.strictEqual(rows.length, 1);
  assert.ok(rows[0].bookValuePerShare != null, 'bookValuePerShare should be set');
  assert.strictEqual(rows[0].bookValuePerShare, equity / shares);  // $10.00
  assert.strictEqual(rows[0].totalStockholdersEquity, equity);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
