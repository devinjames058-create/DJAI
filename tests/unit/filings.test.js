'use strict';
const assert = require('assert');
const { _test } = require('../../api/filings');

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

console.log('\nFilings tests\n');

test('_normalizeTicker handles BRK.B-style tickers', () => {
  assert.strictEqual(_test._normalizeTicker('brk.b'), 'BRKB');
  assert.strictEqual(_test._normalizeTicker('BRK-B'), 'BRKB');
});

test('_buildAnnualFilings keeps annual forms only and maps filedDate', () => {
  const filings = _test._buildAnnualFilings({
    filings: {
      recent: {
        form: ['8-K', '10-Q', '10-K', '20-F/A', '40-F', '6-K'],
        filingDate: ['2025-03-01', '2025-02-01', '2025-01-31', '2024-03-15', '2023-02-20', '2023-01-10'],
        reportDate: ['2025-02-28', '2024-12-31', '2024-12-31', '2023-12-31', '2022-12-31', '2022-11-30'],
        accessionNumber: ['000-8k', '000-10q', '00001234-25-000001', '00005678-24-000002', '00009999-23-000003', '000-6k'],
        primaryDocument: ['a8k.htm', 'a10q.htm', 'a10k.htm', 'a20fa.htm', 'a40f.htm', 'a6k.htm'],
        primaryDocDescription: ['8-K', '10-Q', '10-K', '20-F/A', '40-F', '6-K'],
      },
    },
  }, '0000123456');

  assert.deepStrictEqual(filings.map((f) => f.form), ['10-K', '20-F/A', '40-F']);
  assert.strictEqual(filings[0].filedDate, '2025-01-31');
  assert.strictEqual(filings[0].accessionNumber, '00001234-25-000001');
  assert.strictEqual(
    filings[0].primaryDocumentPath,
    'https://www.sec.gov/Archives/edgar/data/123456/0000123425000001/a10k.htm'
  );
  assert.strictEqual(
    filings[0].filingIndexUrl,
    'https://www.sec.gov/Archives/edgar/data/123456/0000123425000001/index.json'
  );
});

test('_buildCsv preserves evidence export columns', () => {
  const csv = _test._buildCsv('BRK.B', [{
    fiscalYear: 2025,
    field: 'weightedAverageShsOutDil',
    canonicalValue: '',
    filingEvidenceValue: 2157335139,
    chosenValue: 2157335139,
    source: 'filing_evidence',
    accession: '0001193125-26-083899',
    filedDate: '2026-03-02',
    confidence: 'medium',
    warning: '',
  }]);
  assert.ok(csv.includes('ticker,fiscalYear,field,canonicalValue,filingEvidenceValue,chosenValue,source,accession,filedDate,confidence,warning'));
  assert.ok(csv.includes('BRK.B,2025,weightedAverageShsOutDil,,2157335139,2157335139,filing_evidence,0001193125-26-083899,2026-03-02,medium,'));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
