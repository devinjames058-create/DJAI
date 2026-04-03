'use strict';
const assert = require('assert');
const { _test } = require('../../api/financials');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch(e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

console.log('\nFinancials tests\n');

test('_extractByTags keeps instant annual facts without fp', () => {
  const facts = {
    facts: {
      'us-gaap': {
        Assets: {
          units: {
            USD: [
              { form: '10-K', fy: 2024, end: '2024-12-31', filed: '2025-02-01', val: 1000 },
            ],
          },
        },
      },
    },
  };

  const result = _test._extractByTags(facts, ['Assets']);
  assert.strictEqual(result[2024].val, 1000);
});

test('_extractByTags excludes duration facts that are not full-year', () => {
  const facts = {
    facts: {
      'us-gaap': {
        Revenues: {
          units: {
            USD: [
              { form: '10-K', fy: 2024, fp: 'Q4', start: '2024-10-01', end: '2024-12-31', filed: '2025-02-01', val: 250 },
              { form: '10-K', fy: 2024, fp: 'FY', start: '2024-01-01', end: '2024-12-31', filed: '2025-02-01', val: 1000 },
            ],
          },
        },
      },
    },
  };

  const result = _test._extractByTags(facts, ['Revenues']);
  assert.strictEqual(result[2024].val, 1000);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
