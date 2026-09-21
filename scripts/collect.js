'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateNormalizedReading, kstDate } from '../src/adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const historyPath = path.resolve(__dirname, '../data/history.json');

const HN_MAXITEM_URL = 'https://hacker-news.firebaseio.com/v0/maxitem.json';
const SIGNAL_ID = 'hn-maxitem';
const UNIT = 'items';
const SOURCE_NAME = 'Hacker News (Firebase API)';

async function collect() {
  console.log(`[collect] Fetching live data from ${HN_MAXITEM_URL}...`);
  const fetchedAt = new Date().toISOString();
  
  const response = await fetch(HN_MAXITEM_URL, {
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`Upstream returned HTTP ${response.status}: ${response.statusText}`);
  }

  const rawValue = await response.json();
  const normalizedValue = Number(rawValue);
  if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
    throw new TypeError(`Invalid maxitem value received: ${rawValue}`);
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
  console.log('[collect] Validated reading:', reading);

  // Read existing history
  let history = [];
  if (fs.existsSync(historyPath)) {
    try {
      const content = fs.readFileSync(historyPath, 'utf-8');
      history = JSON.parse(content);
      if (!Array.isArray(history)) history = [];
    } catch (err) {
      console.warn('[collect] Failed to parse existing history, starting new:', err.message);
      history = [];
    }
  }

  // Update or append for today (Asia/Seoul)
  const existingIndex = history.findIndex(
    (item) => item.signal_id === reading.signal_id && item.record_date === reading.record_date
  );

  if (existingIndex >= 0) {
    console.log(`[collect] Updating existing record for ${recordDate} (index ${existingIndex})`);
    history[existingIndex] = reading;
  } else {
    console.log(`[collect] Appending new record for ${recordDate}`);
    history.push(reading);
  }

  // Retention Policy: 최근 30일 데이터만 유지 (오래된 과거 데이터 자동 만료)
  const RETENTION_DAYS = 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffDateStr = cutoff.toISOString().slice(0, 10);
  const initialLength = history.length;
  history = history.filter((item) => item.record_date >= cutoffDateStr);
  if (history.length < initialLength) {
    console.log(`[collect] Pruned ${initialLength - history.length} expired records older than ${cutoffDateStr}`);
  }

  // Sort by record_date ascending
  history.sort((a, b) => a.record_date.localeCompare(b.record_date));

  // Ensure data directory exists
  const dataDir = path.dirname(historyPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + '\n', 'utf-8');
  console.log(`[collect] Successfully saved ${history.length} records to ${historyPath}`);
}

collect().catch((err) => {
  console.error('[collect] Error:', err);
  process.exit(1);
});
