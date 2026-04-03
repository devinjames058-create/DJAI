'use strict';
const assert = require('assert');
const { _test } = require('../../api/financials');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

function verification() {
  return {
    warnings: [],
    fields: {
      incomeStatement: {},
      balanceSheet: {},
      cashFlow: {},
    },
  };
}

function filingsForYear(fy, accession, reportDate, filedDate, form) {
  return {
    byFY: new Map([[fy, {
      accession: accession || '',
      fiscalYear: fy,
      reportDate: reportDate || `${fy}-12-31`,
      filedDate: filedDate || `${fy + 1}-02-01`,
      form: form || '10-K',
      formPriority: 1,
    }]]),
    byAccession: new Map(),
  };
}

console.log('\nFinancials tests\n');

test('_extractDuration accepts null fp only for annual-length duration', () => {
  const facts = {
    facts: { 'us-gaap': { Revenues: { units: { USD: [
      { form: '10-K', fy: 2024, fp: null, start: '2024-01-01', end: '2024-12-31', filed: '2025-02-01', val: 800 },
      { form: '10-K', fy: 2023, fp: null, start: '2023-10-01', end: '2023-12-31', filed: '2024-02-01', val: 200 },
    ] } } } },
  };
  const result = _test._extractDuration(facts, ['Revenues']);
  assert.strictEqual(result.values[2024].value, 800);
  assert.strictEqual(result.values[2023], undefined);
});

test('_extractInstant keeps bank cash tag with null fp', () => {
  const facts = {
    facts: { 'us-gaap': { CashAndDueFromBanks: { units: { USD: [
      { form: '10-K', fy: 2024, end: '2024-12-31', filed: '2025-02-01', val: 1500 },
    ] } } } },
  };
  const result = _test._extractInstant(facts, ['CashAndDueFromBanks']);
  assert.strictEqual(result.values[2024].value, 1500);
});

test('_buildCashFlow populates CapEx from fallback tags and derives FCF', () => {
  const facts = {
    facts: { 'us-gaap': {
      NetCashProvidedByOperatingActivities: { units: { USD: [
        { form: '10-K', fy: 2024, fp: 'FY', start: '2024-01-01', end: '2024-12-31', filed: '2025-02-01', accn: '0001', val: 1000 },
      ] } },
      AdditionsToPropertyPlantAndEquipment: { units: { USD: [
        { form: '10-K', fy: 2024, fp: 'FY', start: '2024-01-01', end: '2024-12-31', filed: '2025-02-01', accn: '0001', val: 250 },
      ] } },
    } },
  };
  const rows = _test._buildCashFlow(facts, filingsForYear(2024, '0001'), verification()).rows;
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].capitalExpenditure, -250);
  assert.strictEqual(rows[0].freeCashFlow, 750);
});

test('_buildIncomeStatement uses diluted EPS fallback tags', () => {
  const facts = {
    facts: { 'us-gaap': {
      DilutedEarningsPerShare: { units: { 'USD/shares': [
        { form: '10-K', fy: 2024, fp: 'FY', start: '2024-01-01', end: '2024-12-31', filed: '2025-02-01', accn: '0002', val: 12.34 },
      ] } },
      NetIncomeLoss: { units: { USD: [
        { form: '10-K', fy: 2024, fp: 'FY', start: '2024-01-01', end: '2024-12-31', filed: '2025-02-01', accn: '0002', val: 5000 },
      ] } },
    } },
  };
  const result = _test._buildIncomeStatement(facts, 'general', filingsForYear(2024, '0002'), verification());
  assert.strictEqual(result.rows[0].epsDiluted, 12.34);
});

test('_buildIncomeStatement falls back to common shares outstanding for diluted shares', () => {
  const facts = {
    facts: { 'us-gaap': {
      Revenues: { units: { USD: [
        { form: '10-K', fy: 2024, fp: 'FY', start: '2024-01-01', end: '2024-12-31', filed: '2025-02-01', accn: '0003', val: 1000 },
      ] } },
      CommonStockSharesOutstanding: { units: { shares: [
        { form: '10-K', fy: 2024, end: '2024-12-31', filed: '2025-02-01', accn: '0003', val: 250 },
      ] } },
    } },
  };
  const result = _test._buildIncomeStatement(facts, 'general', filingsForYear(2024, '0003'), verification());
  assert.strictEqual(result.rows[0].weightedAverageShsOutDil, 250);
  assert.ok(result.maps.weightedAverageShsOutDil.meta[2024].warnings.some((w) => w.includes('fallback')));
});

test('_buildBalanceSheet derives BVPS from equity and diluted-share map', () => {
  const facts = {
    facts: { 'us-gaap': {
      Assets: { units: { USD: [{ form: '10-K', fy: 2024, end: '2024-12-31', filed: '2025-02-01', accn: '0004', val: 2000 }] } },
      Liabilities: { units: { USD: [{ form: '10-K', fy: 2024, end: '2024-12-31', filed: '2025-02-01', accn: '0004', val: 1200 }] } },
      StockholdersEquity: { units: { USD: [{ form: '10-K', fy: 2024, end: '2024-12-31', filed: '2025-02-01', accn: '0004', val: 800 }] } },
    } },
  };
  const incomeMaps = {
    weightedAverageShsOutDil: {
      values: { 2024: { value: 100, end: '2024-12-31' } },
      meta: { 2024: { tagUsed: 'fallback:CommonStockSharesOutstanding', sourceType: 'share_count', confidence: 'medium', warnings: [] } },
    },
  };
  const rows = _test._buildBalanceSheet(facts, filingsForYear(2024, '0004'), incomeMaps, verification()).rows;
  assert.strictEqual(rows[0].bookValuePerShare, 8);
});

test('_buildBalanceSheet uses bank debt and liabilities fallback tags', () => {
  const facts = {
    facts: { 'us-gaap': {
      Assets: { units: { USD: [{ form: '10-K', fy: 2024, end: '2024-12-31', filed: '2025-02-01', accn: '0005', val: 9000 }] } },
      TotalLiabilities: { units: { USD: [{ form: '10-K', fy: 2024, end: '2024-12-31', filed: '2025-02-01', accn: '0005', val: 7000 }] } },
      LongTermFHLBAdvances: { units: { USD: [{ form: '10-K', fy: 2024, end: '2024-12-31', filed: '2025-02-01', accn: '0005', val: 600 }] } },
      CashAndDueFromBanks: { units: { USD: [{ form: '10-K', fy: 2024, end: '2024-12-31', filed: '2025-02-01', accn: '0005', val: 1100 }] } },
      StockholdersEquity: { units: { USD: [{ form: '10-K', fy: 2024, end: '2024-12-31', filed: '2025-02-01', accn: '0005', val: 2000 }] } },
    } },
  };
  const incomeMaps = { weightedAverageShsOutDil: { values: {}, meta: {} } };
  const rows = _test._buildBalanceSheet(facts, filingsForYear(2024, '0005'), incomeMaps, verification()).rows;
  assert.strictEqual(rows[0].cashAndCashEquivalents, 1100);
  assert.strictEqual(rows[0].longTermDebt, 600);
  assert.strictEqual(rows[0].totalLiabilities, 7000);
});

test('_edgarQualityOk is statement-aware', () => {
  const ok = _test._edgarQualityOk(
    [{ revenue: null, netIncome: null, operatingIncome: null, epsDiluted: null, weightedAverageShsOutDil: 100 }],
    [{ totalAssets: 5000, totalStockholdersEquity: null }],
    [{ operatingCashFlow: 250 }],
  );
  assert.strictEqual(ok, true);
});

test('_mergeSupplementSection fills only missing fields from supplemental rows', () => {
  const verificationState = verification();
  const baseRows = [{
    year: '2024',
    calendarYear: '2024',
    epsDiluted: null,
    weightedAverageShsOutDil: 100,
  }];
  const supplementRows = [{
    year: '2024',
    calendarYear: '2024',
    epsDiluted: 12.5,
    weightedAverageShsOutDil: 150,
  }];
  const changed = _test._mergeSupplementSection(
    baseRows,
    supplementRows,
    'incomeStatement',
    ['epsDiluted', 'weightedAverageShsOutDil'],
    verificationState
  );
  assert.strictEqual(changed, 1);
  assert.strictEqual(baseRows[0].epsDiluted, 12.5);
  assert.strictEqual(baseRows[0].weightedAverageShsOutDil, 100);
  assert.strictEqual(verificationState.fields.incomeStatement[2024].epsDiluted.sourceType, 'supplemental_fallback');
});

test('_deriveSupplementedBookValuePerShare uses supplemented shares when direct BVPS is blank', () => {
  const verificationState = verification();
  const incomeRows = [{
    year: '2024',
    calendarYear: '2024',
    weightedAverageShsOutDil: 200,
  }];
  const balanceRows = [{
    year: '2024',
    calendarYear: '2024',
    totalStockholdersEquity: 1000,
    bookValuePerShare: null,
  }];
  const changed = _test._deriveSupplementedBookValuePerShare(incomeRows, balanceRows, verificationState);
  assert.strictEqual(changed, 1);
  assert.strictEqual(balanceRows[0].bookValuePerShare, 5);
  assert.strictEqual(verificationState.fields.balanceSheet[2024].bookValuePerShare.sourceType, 'derived');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
