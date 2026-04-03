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

test('_buildIncomeStatement does not create a new year from instant share fallback alone', () => {
  const facts = {
    facts: { 'us-gaap': {
      Revenues: { units: { USD: [
        { form: '10-K', fy: 2024, fp: 'FY', start: '2024-01-01', end: '2024-12-31', filed: '2025-02-01', accn: '0003', val: 1000 },
      ] } },
      CommonStockSharesOutstanding: { units: { shares: [
        { form: '10-K', fy: 2025, end: '2025-02-15', filed: '2025-02-15', accn: '0004', val: 250 },
      ] } },
    } },
  };
  const filings = {
    byFY: new Map([[2024, {
      accession: '0003',
      fiscalYear: 2024,
      reportDate: '2024-12-31',
      filedDate: '2025-02-01',
      form: '10-K',
      formPriority: 1,
    }]]),
    byAccession: new Map(),
  };
  const result = _test._buildIncomeStatement(facts, 'general', filings, verification());
  assert.deepStrictEqual(result.rows.map((row) => row.year), ['2024']);
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

test('_buildBalanceSheet keeps fiscal year and date aligned for comparative instant facts', () => {
  const filings = {
    byFY: new Map([
      [2024, { accession: '0006', fiscalYear: 2024, reportDate: '2024-12-31', filedDate: '2025-02-01', form: '10-K', formPriority: 1 }],
      [2023, { accession: '0005', fiscalYear: 2023, reportDate: '2023-12-31', filedDate: '2024-02-01', form: '10-K', formPriority: 1 }],
    ]),
    byAccession: new Map(),
  };
  const facts = {
    facts: { 'us-gaap': {
      Assets: { units: { USD: [
        { form: '10-K', fy: 2024, end: '2024-12-31', filed: '2025-02-01', accn: '0006', val: 1000 },
        { form: '10-K', fy: 2024, end: '2023-12-31', filed: '2025-02-01', accn: '0006', val: 900 },
      ] } },
      Liabilities: { units: { USD: [
        { form: '10-K', fy: 2024, end: '2024-12-31', filed: '2025-02-01', accn: '0006', val: 600 },
        { form: '10-K', fy: 2024, end: '2023-12-31', filed: '2025-02-01', accn: '0006', val: 500 },
      ] } },
      StockholdersEquity: { units: { USD: [
        { form: '10-K', fy: 2024, end: '2024-12-31', filed: '2025-02-01', accn: '0006', val: 400 },
        { form: '10-K', fy: 2024, end: '2023-12-31', filed: '2025-02-01', accn: '0006', val: 400 },
      ] } },
    } },
  };
  const incomeMaps = { weightedAverageShsOutDil: { values: {}, meta: {} } };
  const rows = _test._buildBalanceSheet(facts, filings, incomeMaps, verification()).rows;
  assert.strictEqual(rows[0].year, '2024');
  assert.strictEqual(rows[0].date, '2024-12-31');
  assert.strictEqual(rows[1].year, '2023');
  assert.strictEqual(rows[1].date, '2023-12-31');
});

test('_buildBalanceSheet derives liabilities from assets and equity when liabilities are missing', () => {
  const facts = {
    facts: { 'us-gaap': {
      Assets: { units: { USD: [{ form: '10-K', fy: 2024, end: '2024-12-31', filed: '2025-02-01', accn: '0007', val: 1200 }] } },
      StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest: { units: { USD: [{ form: '10-K', fy: 2024, end: '2024-12-31', filed: '2025-02-01', accn: '0007', val: 300 }] } },
    } },
  };
  const incomeMaps = { weightedAverageShsOutDil: { values: {}, meta: {} } };
  const rows = _test._buildBalanceSheet(facts, filingsForYear(2024, '0007'), incomeMaps, verification()).rows;
  assert.strictEqual(rows[0].totalLiabilities, 900);
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

test('_mergeSupplementSection does not overwrite non-null canonical values', () => {
  const verificationState = verification();
  const baseRows = [{
    year: '2024',
    date: '2024-12-31',
    calendarYear: '2024',
    epsDiluted: 9.5,
  }];
  const supplementRows = [{
    year: '2024',
    date: '2024-12-31',
    calendarYear: '2024',
    epsDiluted: 12.5,
  }];
  const changed = _test._mergeSupplementSection(baseRows, supplementRows, 'incomeStatement', ['epsDiluted'], verificationState);
  assert.strictEqual(changed, 0);
  assert.strictEqual(baseRows[0].epsDiluted, 9.5);
});

test('_mergeSupplementSection only merges into existing matching annual rows', () => {
  const verificationState = verification();
  const baseRows = [{
    year: '2024',
    date: '2024-12-31',
    calendarYear: '2024',
    longTermDebt: null,
  }];
  const supplementRows = [{
    year: '2024',
    date: '2025-12-31',
    calendarYear: '2024',
    longTermDebt: 100,
  }, {
    year: '2025',
    date: '2025-12-31',
    calendarYear: '2025',
    longTermDebt: 200,
  }];
  const changed = _test._mergeSupplementSection(baseRows, supplementRows, 'balanceSheet', ['longTermDebt'], verificationState);
  assert.strictEqual(changed, 0);
  assert.strictEqual(baseRows[0].longTermDebt, null);
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

test('_deriveSupplementedBookValuePerShare does not derive without a valid share-count basis', () => {
  const verificationState = verification();
  const incomeRows = [{
    year: '2024',
    calendarYear: '2024',
    weightedAverageShsOutDil: null,
  }];
  const balanceRows = [{
    year: '2024',
    calendarYear: '2024',
    totalStockholdersEquity: 1000,
    bookValuePerShare: null,
  }];
  const changed = _test._deriveSupplementedBookValuePerShare(incomeRows, balanceRows, verificationState);
  assert.strictEqual(changed, 0);
  assert.strictEqual(balanceRows[0].bookValuePerShare, null);
});

test('_annotateUnresolvedFinancialFields leaves unresolved BRK-style fields null and adds warnings', () => {
  const verificationState = verification();
  const facts = {
    facts: { 'us-gaap': {
      DebtAndCapitalLeaseObligations: { units: {
        EUR: [{ form: '10-K', fy: 2024, fp: 'FY', end: '2024-12-31', filed: '2025-02-01', val: 100 }],
        JPY: [{ form: '10-K', fy: 2024, fp: 'FY', end: '2024-12-31', filed: '2025-02-01', val: 200 }],
      } },
    } },
  };
  const incomeRows = [{
    year: '2024',
    date: '2024-12-31',
    calendarYear: '2024',
    epsDiluted: null,
    weightedAverageShsOutDil: null,
  }];
  const balanceRows = [{
    year: '2024',
    date: '2024-12-31',
    calendarYear: '2024',
    totalStockholdersEquity: 1000,
    longTermDebt: null,
    bookValuePerShare: null,
  }];
  _test._annotateUnresolvedFinancialFields(facts, incomeRows, balanceRows, verificationState);
  assert.ok(verificationState.warnings.includes('No usable annual diluted EPS fact found in companyfacts for some rows'));
  assert.ok(verificationState.warnings.includes('No usable annual diluted share-count fact found in companyfacts for some rows'));
  assert.ok(verificationState.warnings.includes('Book value per share not derived for some rows because share-count basis was unavailable'));
  assert.ok(verificationState.warnings.includes('Long-term debt unavailable because only mixed-currency or non-comparable annual facts were found'));
  assert.strictEqual(verificationState.fields.incomeStatement[2024].epsDiluted.sourceType, 'unavailable');
  assert.strictEqual(verificationState.fields.balanceSheet[2024].longTermDebt.sourceType, 'unavailable');
});

test('_hasAnnualFactInUnits detects mixed-currency debt without treating it as USD', () => {
  const facts = {
    facts: { 'us-gaap': {
      DebtAndCapitalLeaseObligations: { units: {
        EUR: [{ form: '10-K', fy: 2024, fp: 'FY', end: '2024-12-31', filed: '2025-02-01', val: 100 }],
        JPY: [{ form: '10-K', fy: 2024, fp: 'FY', end: '2024-12-31', filed: '2025-02-01', val: 200 }],
      } },
    } },
  };
  assert.strictEqual(_test._hasAnnualFactInUnits(facts, ['DebtAndCapitalLeaseObligations'], ['USD']), false);
  assert.strictEqual(_test._hasAnnualFactInUnits(facts, ['DebtAndCapitalLeaseObligations'], [], ['EUR', 'JPY']), true);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
