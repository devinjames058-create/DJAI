#!/usr/bin/env node
'use strict';
// Run all unit tests
const { execSync } = require('child_process');
const tests = [
  'tests/unit/trust.test.js',
  'tests/unit/metrics.test.js',
  'tests/unit/reconcile.test.js',
];
let anyFailed = false;
for (const t of tests) {
  try {
    execSync(`node ${t}`, { stdio: 'inherit', cwd: require('path').join(__dirname, '..') });
  } catch(e) {
    anyFailed = true;
  }
}
process.exit(anyFailed ? 1 : 0);
