'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resetEvaluationState,
  runFixture,
  validateNormalizedReading,
  validateStatus
} from '../src/adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, '../assets/t04-real-information-board-public-v1/fixtures');

function loadFixture(name) {
  const content = fs.readFileSync(path.join(fixturesDir, name), 'utf-8');
  return JSON.parse(content);
}

console.log('--- Testing Adapter with Synthetic Fixtures ---');

// 1. Success sequence: D1-A -> D1-B -> D2
let state = resetEvaluationState();
const d1a = loadFixture('normal-d1-a.json');
state = runFixture(state, d1a);
console.assert(state.daily_readings.length === 1, 'D1-A should create 1 reading');
console.assert(state.status.freshness === 'fresh' && state.status.error_code === 'none', 'D1-A fresh/none');
console.assert(state.last_comparison.state === 'insufficient', 'D1-A comparison insufficient');

const d1b = loadFixture('normal-d1-b.json');
state = runFixture(state, d1b);
console.assert(state.daily_readings.length === 1, 'D1-B should replace same-date reading (C20)');
console.assert(state.current_reading.normalized_value === d1b.payload.normalized_value, 'D1-B updated value');

const d2 = loadFixture('normal-d2.json');
state = runFixture(state, d2);
console.assert(state.daily_readings.length === 2, 'D2 should add second reading (C21)');
console.assert(state.last_comparison.state === 'comparable', 'D2 comparison comparable');
console.assert(state.last_comparison.magnitude === 15, 'D2 delta magnitude should be 15');
console.assert(state.last_comparison.direction === 'increase', 'D2 delta should be increase');
console.log('✓ Success sequence (D1-A -> D1-B -> D2) passed');

// 2. Failure fixtures & Last known good value preservation (C12~C18)
const failures = [
  { file: 'timeout.json', code: 'timeout' },
  { file: 'auth-401.json', code: 'auth' },
  { file: 'rate-429.json', code: 'rate_limit' },
  { file: 'offline.json', code: 'offline' },
  { file: 'schema-break.json', code: 'schema_error' }
];

for (const { file, code } of failures) {
  // Baseline D1-A -> D1-B
  let fState = resetEvaluationState();
  fState = runFixture(fState, d1a);
  fState = runFixture(fState, d1b);
  const lastKnownValue = fState.current_reading.normalized_value;

  const fixture = loadFixture(file);
  fState = runFixture(fState, fixture);

  console.assert(fState.status.freshness === 'stale', `${file} must transition to stale (C18)`);
  console.assert(fState.status.error_code === code, `${file} must match error code ${code}`);
  console.assert(fState.current_reading !== null, `${file} must preserve current_reading (C17)`);
  console.assert(fState.current_reading.normalized_value === lastKnownValue, `${file} value must match last known`);
  console.log(`✓ Failure fixture ${file} (${code}) passed`);
}

// 3. Recovery sequence: D1-A -> D1-B -> timeout -> recover-d2 (C19)
let rState = resetEvaluationState();
rState = runFixture(rState, d1a);
rState = runFixture(rState, d1b);
rState = runFixture(rState, loadFixture('timeout.json'));
console.assert(rState.status.freshness === 'stale', 'Must be stale before recovery');

const recover = loadFixture('recover-d2.json');
rState = runFixture(rState, recover);
console.assert(rState.status.freshness === 'fresh', 'Recover must return to fresh (C19)');
console.assert(rState.status.error_code === 'none', 'Recover error_code must be none (C19)');
console.assert(rState.daily_readings.length === 2, 'Recover must append next day reading (C19)');
console.log('✓ Recovery sequence passed');

console.log('ALL ADAPTER TESTS PASSED SUCCESSFULLY');
