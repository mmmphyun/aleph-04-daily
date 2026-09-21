'use strict';

import {
  applyError,
  applySuccessfulReading,
  kstDate,
  resetEvaluationState,
  validateNormalizedReading
} from './adapter.js';

const HN_MAXITEM_URL = 'https://hacker-news.firebaseio.com/v0/maxitem.json';
const SIGNAL_ID = 'hn-maxitem';
const UNIT = 'items';
const SOURCE_NAME = 'Hacker News (Firebase API)';
const TIMEOUT_MS = 5000;

// Application State
let appState = resetEvaluationState();
let rawLiveResponse = null;

// DOM Elements
const elStatusBanner = document.getElementById('status-banner');
const elStatusBadge = document.getElementById('status-badge');
const elStatusDesc = document.getElementById('status-desc');
const elRetryBtn = document.getElementById('btn-retry');

const elMetricValue = document.getElementById('metric-value');
const elMetricUnit = document.getElementById('metric-unit');
const elMetricDelta = document.getElementById('metric-delta');

const elSourceObservedAt = document.getElementById('meta-source-time');
const elFetchedAt = document.getElementById('meta-fetched-at');
const elTimezone = document.getElementById('meta-timezone');
const elSourceUrl = document.getElementById('meta-source-url');
const elSourceName = document.getElementById('meta-source-name');

const elHistoryTableBody = document.getElementById('history-table-body');
const elRawJson = document.getElementById('raw-json');
const elRefreshBtn = document.getElementById('btn-refresh');
const elTopStoriesList = document.getElementById('top-stories-list');

/**
 * 초기 영속 데이터(data/history.json) 로드
 */
async function loadPersistedHistory() {
  try {
    const res = await fetch('./data/history.json');
    if (!res.ok) {
      console.warn('Could not load history.json (HTTP ' + res.status + ')');
      return;
    }
    const items = await res.json();
    if (Array.isArray(items)) {
      for (const item of items) {
        appState = applySuccessfulReading(appState, item);
      }
    }
  } catch (err) {
    console.warn('Failed to fetch persisted history:', err);
  }
}

/**
 * 실시간 Hacker News API 호출 및 에러 포착
 */
async function fetchLiveReading() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const fetchedAt = new Date().toISOString();

  try {
    if (!navigator.onLine) {
      throw new Error('NETWORK_OFFLINE');
    }

    const response = await fetch(HN_MAXITEM_URL, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });

    clearTimeout(timeoutId);

    if (response.status === 401 || response.status === 403) {
      appState = applyError(appState, 'auth');
      render();
      return;
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      appState = applyError(appState, 'rate_limit', {
        retry_after_seconds: retryAfter ? Number(retryAfter) : null
      });
      render();
      return;
    }
    if (!response.ok) {
      appState = applyError(appState, 'schema_error');
      render();
      return;
    }

    const rawValue = await response.json();
    rawLiveResponse = rawValue;

    const normalizedValue = Number(rawValue);
    if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
      appState = applyError(appState, 'schema_error');
      render();
      return;
    }

    const headerDate = response.headers.get('date');
    let sourceTime = null;
    if (headerDate) {
      const parsed = new Date(headerDate);
      if (!Number.isNaN(parsed.getTime())) {
        sourceTime = parsed.toISOString();
      }
    }

    const recordDate = kstDate(fetchedAt);

    const reading = {
      signal_id: SIGNAL_ID,
      normalized_value: normalizedValue,
      unit: UNIT,
      source_name: SOURCE_NAME,
      source_url: HN_MAXITEM_URL,
      source_time: sourceTime,
      fetched_at: fetchedAt,
      record_timezone: 'Asia/Seoul',
      record_date: recordDate
    };

    validateNormalizedReading(reading);
    appState = applySuccessfulReading(appState, reading);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      appState = applyError(appState, 'timeout');
    } else if (err.message === 'NETWORK_OFFLINE' || err instanceof TypeError) {
      appState = applyError(appState, 'offline');
    } else {
      appState = applyError(appState, 'schema_error');
    }
  }

  render();
}

/**
 * UI 렌더링
 */
function render() {
  const current = appState.current_reading;
  const status = appState.status;

  // 1. 상태 배너 및 에러 핸들링 (C17, C18, C19)
  if (!status || status.freshness === 'fresh') {
    elStatusBanner.className = 'status-banner fresh';
    elStatusBadge.className = 'stamp stamp-fresh';
    elStatusBadge.textContent = '정상 (FRESH)';
    elStatusDesc.textContent = '외부 원천과 정상 통신 중입니다. 실시간 최신 관측값입니다.';
    elRetryBtn.style.display = 'none';
  } else {
    elStatusBanner.className = 'status-banner stale';
    elStatusBadge.className = 'stamp stamp-stale';
    elStatusBadge.textContent = `오래된 값 (${status.error_code.toUpperCase()})`;

    const errorGuides = {
      timeout: '외부 원천 응답 시간이 초과되었습니다. 마지막 정상값을 보존합니다.',
      auth: '외부 원천 인증에 실패했습니다. 마지막 정상값을 보존합니다.',
      rate_limit: '외부 원천 호출 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.',
      offline: '네트워크 연결이 끊겼습니다. 마지막 정상값을 보존합니다.',
      schema_error: '원천 응답 형식이 올바르지 않습니다. 마지막 정상값을 보존합니다.'
    };
    elStatusDesc.textContent = errorGuides[status.error_code] || '데이터 갱신에 실패했습니다. 마지막 정상값을 유지합니다.';
    elRetryBtn.style.display = 'inline-flex';
  }

  // 2. 메트릭 카드 (C04, C05, C17)
  if (current) {
    elMetricValue.textContent = Number(current.normalized_value).toLocaleString();
    elMetricUnit.textContent = current.unit;

    // 출처 시각 및 조회 시각 (C07, C08, C09)
    elSourceObservedAt.textContent = current.source_time
      ? formatIsoKst(current.source_time)
      : '(응답 헤더에 시각 정보 없음)';
    elFetchedAt.textContent = formatIsoKst(current.fetched_at);
    elTimezone.textContent = `${current.record_timezone} (KST)`;
    elSourceName.textContent = current.source_name;
    elSourceUrl.textContent = current.source_url;
    elSourceUrl.href = current.source_url;
  } else {
    elMetricValue.textContent = '-';
    elMetricUnit.textContent = UNIT;
    elSourceObservedAt.textContent = '-';
    elFetchedAt.textContent = '-';
    elTimezone.textContent = 'Asia/Seoul (KST)';
    elSourceName.textContent = SOURCE_NAME;
    elSourceUrl.textContent = HN_MAXITEM_URL;
    elSourceUrl.href = HN_MAXITEM_URL;
  }

  // 3. 어제 대비 변화값 계산 렌더링 (C24)
  const comparison = appState.last_comparison;
  if (comparison && comparison.state === 'comparable') {
    const sign = comparison.direction === 'increase' ? '+' : comparison.direction === 'decrease' ? '-' : '';
    const arrow = comparison.direction === 'increase' ? '▲' : comparison.direction === 'decrease' ? '▼' : '―';
    const className = comparison.direction === 'increase' ? 'delta-increase' : comparison.direction === 'decrease' ? 'delta-decrease' : 'delta-neutral';

    elMetricDelta.className = `metric-delta ${className}`;
    elMetricDelta.innerHTML = `어제 대비 <strong>${arrow} ${sign}${Number(comparison.magnitude).toLocaleString()} ${comparison.unit}</strong>`;
  } else {
    elMetricDelta.className = 'metric-delta delta-neutral';
    elMetricDelta.textContent = '어제 대비 변화량: 비교할 전일 기록이 필요합니다 (최소 2일치 필요)';
  }

  // 4. 일별 영속 기록 테이블 렌더링 (C22, C23)
  elHistoryTableBody.innerHTML = '';
  for (const row of appState.daily_readings) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${row.record_date}</strong></td>
      <td>${Number(row.normalized_value).toLocaleString()} ${row.unit}</td>
      <td>${formatIsoKst(row.last_fetched_at)}</td>
      <td><a href="${row.reading.source_url}" target="_blank" rel="noopener noreferrer">${row.reading.source_name}</a></td>
    `;
    elHistoryTableBody.appendChild(tr);
  }

  // 5. 디버그 JSON 상태 출력
  if (elRawJson) {
    elRawJson.textContent = JSON.stringify(
      {
        status: appState.status,
        current_reading: appState.current_reading,
        last_comparison: appState.last_comparison,
        raw_live_response: rawLiveResponse,
        daily_readings_count: appState.daily_readings.length
      },
      null,
      2
    );
  }
}

function formatIsoKst(isoString) {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    return d.toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }) + ' KST';
  } catch {
    return isoString;
  }
}

/**
 * 실시간 Hacker News Top 5 인기 기사 로드 (보조 피드, 실패 시 격리)
 */
async function fetchTopStories() {
  if (!elTopStoriesList) return;
  try {
    const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ids = await res.json();
    const top5Ids = Array.isArray(ids) ? ids.slice(0, 5) : [];

    const storyPromises = top5Ids.map(async (id) => {
      const itemRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      if (!itemRes.ok) return null;
      return itemRes.json();
    });

    const stories = (await Promise.all(storyPromises)).filter(Boolean);

    elTopStoriesList.innerHTML = '';
    stories.forEach((story, idx) => {
      const li = document.createElement('li');
      li.className = 'top-story-item';
      const storyUrl = story.url || `https://news.ycombinator.com/item?id=${story.id}`;
      const score = story.score ?? 0;
      const by = story.by ?? 'anonymous';
      const comments = story.descendants ?? 0;

      li.innerHTML = `
        <span class="story-rank">${idx + 1}</span>
        <div class="story-content">
          <a class="story-title" href="${storyUrl}" target="_blank" rel="noopener noreferrer">${story.title}</a>
          <div class="story-meta">
            <span>★ ${score} points</span>
            <span>by ${by}</span>
            <span>💬 ${comments} comments</span>
          </div>
        </div>
      `;
      elTopStoriesList.appendChild(li);
    });
  } catch (err) {
    console.warn('Failed to fetch top stories (non-blocking):', err.message);
    elTopStoriesList.innerHTML = `<li style="color: var(--text-muted); font-size: 0.85rem;">인기 기사를 불러오지 못했습니다 (${err.message}). 메인 지표는 정상 동작 중입니다.</li>`;
  }
}

// Event Listeners
elRefreshBtn.addEventListener('click', () => {
  fetchLiveReading();
  fetchTopStories();
});

elRetryBtn.addEventListener('click', () => {
  fetchLiveReading();
  fetchTopStories();
});

// App Bootstrap
async function bootstrap() {
  await loadPersistedHistory();
  render();
  // 실시간 데이터 조회 및 Top 5 로드
  await Promise.allSettled([
    fetchLiveReading(),
    fetchTopStories()
  ]);
}

bootstrap();
