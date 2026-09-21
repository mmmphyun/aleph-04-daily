'use strict';

import {
  applyError,
  applySuccessfulReading,
  kstDate,
  resetEvaluationState,
  runFixture,
  validateNormalizedReading
} from './adapter.js';

const HN_MAXITEM_URL = 'https://hacker-news.firebaseio.com/v0/maxitem.json';
const FIXTURES_BASE = './assets/t04-real-information-board-public-v1/fixtures/';

let debugState = resetEvaluationState();

// DOM Elements
const elStateDump = document.getElementById('debug-state-dump');
const elPingResult = document.getElementById('ping-result');
const elCurrentStatusBadge = document.getElementById('debug-status-badge');
const elCurrentReadingValue = document.getElementById('debug-current-value');
const elComparisonText = document.getElementById('debug-comparison-text');
const elRowCount = document.getElementById('debug-row-count');

function updateView() {
  elStateDump.textContent = JSON.stringify(debugState, null, 2);

  const status = debugState.status;
  if (!status) {
    elCurrentStatusBadge.className = 'stamp stamp-stale';
    elCurrentStatusBadge.textContent = '초기 상태';
  } else if (status.freshness === 'fresh') {
    elCurrentStatusBadge.className = 'stamp stamp-fresh';
    elCurrentStatusBadge.textContent = '정상 (FRESH)';
  } else {
    elCurrentStatusBadge.className = 'stamp stamp-stale';
    elCurrentStatusBadge.textContent = `오래된 값 (${status.error_code.toUpperCase()})`;
  }

  if (debugState.current_reading) {
    elCurrentReadingValue.textContent = `${Number(debugState.current_reading.normalized_value).toLocaleString()} ${debugState.current_reading.unit}`;
  } else {
    elCurrentReadingValue.textContent = '보존된 값 없음';
  }

  const comp = debugState.last_comparison;
  if (comp && comp.state === 'comparable') {
    const arrow = comp.direction === 'increase' ? '▲' : comp.direction === 'decrease' ? '▼' : '―';
    const dirText = comp.direction === 'increase' ? '증가' : comp.direction === 'decrease' ? '감소' : '변화 없음';
    elComparisonText.textContent = `${arrow} 전일 대비 ${comp.magnitude} ${comp.unit} ${dirText}`;
  } else if (comp) {
    elComparisonText.textContent = `비교 상태: ${comp.state === 'insufficient' ? '비교 대상 기록 부족' : comp.state}`;
  } else {
    elComparisonText.textContent = '-';
  }

  elRowCount.textContent = `${debugState.daily_readings.length}건`;
}

/**
 * Fixture 파일 로드 및 실행
 */
async function triggerFixture(fixtureFilename) {
  try {
    const res = await fetch(FIXTURES_BASE + fixtureFilename);
    if (!res.ok) throw new Error(`HTTP ${res.status} 시험 파일 로드 실패`);
    const fixture = await res.json();
    debugState = runFixture(debugState, fixture);
    updateView();
  } catch (err) {
    alert(`시험 파일 로드 실패: ${err.message}`);
  }
}

/**
 * 실제 Hacker News API 진단 및 Ping
 */
async function runLivePing() {
  elPingResult.textContent = 'Hacker News 엔드포인트로 연결을 확인하고 있습니다...';
  const start = performance.now();

  try {
    const res = await fetch(HN_MAXITEM_URL, { cache: 'no-store' });
    const rtt = (performance.now() - start).toFixed(1);
    const dateHeader = res.headers.get('date');
    const status = res.status;
    const ok = res.ok;

    if (!ok) {
      elPingResult.textContent = `[연결 실패] HTTP ${status}\n왕복 지연시간: ${rtt}ms\nDate 헤더: ${dateHeader}`;
      return;
    }

    const val = await res.json();
    const isNum = typeof val === 'number' && Number.isFinite(val);

    elPingResult.textContent = [
      `[연결 성공] HTTP ${status} OK`,
      `왕복 지연시간: ${rtt} ms`,
      `응답 Date 헤더: ${dateHeader || '(헤더 시각 없음)'}`,
      `수신된 원자료(maxitem): ${val}`,
      `값 유효성: ${isNum ? '정상 수치' : '유효하지 않은 값'}`,
      `기준 일자(KST): ${kstDate(new Date().toISOString())}`
    ].join('\n');
  } catch (err) {
    const rtt = (performance.now() - start).toFixed(1);
    elPingResult.textContent = `[연결 오류] ${err.name}: ${err.message}\n소요 시간: ${rtt} ms`;
  }
}

/**
 * 모의 장애 주입
 */
function injectFault(type) {
  switch (type) {
    case 'timeout':
      debugState = applyError(debugState, 'timeout', { outcome: 'injected_fault' });
      break;
    case 'auth':
      debugState = applyError(debugState, 'auth', { outcome: 'injected_fault' });
      break;
    case 'rate_limit':
      debugState = applyError(debugState, 'rate_limit', { retry_after_seconds: 60, outcome: 'injected_fault' });
      break;
    case 'offline':
      debugState = applyError(debugState, 'offline', { outcome: 'injected_fault' });
      break;
    case 'schema_error':
      debugState = applyError(debugState, 'schema_error', { outcome: 'injected_fault' });
      break;
  }
  updateView();
}

// 이벤트 바인딩
document.getElementById('btn-ping').addEventListener('click', runLivePing);

document.getElementById('btn-reset').addEventListener('click', () => {
  debugState = resetEvaluationState();
  updateView();
});

// Fixture 버튼
document.getElementById('fx-d1-a').addEventListener('click', () => triggerFixture('normal-d1-a.json'));
document.getElementById('fx-d1-b').addEventListener('click', () => triggerFixture('normal-d1-b.json'));
document.getElementById('fx-d2').addEventListener('click', () => triggerFixture('normal-d2.json'));

document.getElementById('fx-fail-timeout').addEventListener('click', () => triggerFixture('timeout.json'));
document.getElementById('fx-fail-auth').addEventListener('click', () => triggerFixture('auth-401.json'));
document.getElementById('fx-fail-rate').addEventListener('click', () => triggerFixture('rate-429.json'));
document.getElementById('fx-fail-offline').addEventListener('click', () => triggerFixture('offline.json'));
document.getElementById('fx-fail-schema').addEventListener('click', () => triggerFixture('schema-break.json'));

document.getElementById('fx-recover').addEventListener('click', () => triggerFixture('recover-d2.json'));

// 모의 장애 주입 버튼
document.getElementById('fault-timeout').addEventListener('click', () => injectFault('timeout'));
document.getElementById('fault-auth').addEventListener('click', () => injectFault('auth'));
document.getElementById('fault-rate').addEventListener('click', () => injectFault('rate_limit'));
document.getElementById('fault-offline').addEventListener('click', () => injectFault('offline'));
document.getElementById('fault-schema').addEventListener('click', () => injectFault('schema_error'));

// 초기 뷰 설정
updateView();
