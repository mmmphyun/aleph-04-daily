'use strict';

import assert from 'node:assert';

// 10개 고정 검사 메타데이터
const TESTS = [
  { id: 'TEST-01', name: '정상 상태 처리 (CLOSED 상태 성공)' },
  { id: 'TEST-02', name: '단일 실패 카운팅 (CLOSED 유지)' },
  { id: 'TEST-03', name: '임계치 도달 시 OPEN 전이' },
  { id: 'TEST-04', name: 'OPEN 상태 빠른 실패 (CircuitOpenError)' },
  { id: 'TEST-05', name: '쿨다운 만료 후 HALF_OPEN 전이' },
  { id: 'TEST-06', name: 'HALF_OPEN 상태에서 성공 시 CLOSED 복구' },
  { id: 'TEST-07', name: 'HALF_OPEN 상태에서 실패 시 OPEN 재전이' },
  { id: 'TEST-08', name: '지수 백오프 딜레이 계산 (기본 지수 증가)' },
  { id: 'TEST-09', name: '최대 백오프 상한선 제한 (Max Cap)' },
  { id: 'TEST-10', name: 'Dead Letter Queue (DLQ) 실패 페이로드 적재' }
];

async function runAll() {
  console.log('====================================================');
  console.log(' 과제 5 고정 검사 10개 실행: scripts/test-resilience.js');
  console.log('====================================================\n');

  let mod;
  try {
    mod = await import('../src/resilience.js');
  } catch (err) {
    console.error('[FATAL] src/resilience.js 모듈 로드 실패:', err.message);
    console.log('\n결과: 0 PASS / 10 FAIL');
    process.exit(1);
  }

  const { CircuitBreaker, CircuitOpenError, calculateBackoff, DeadLetterQueue } = mod;

  let passed = 0;
  let failed = 0;

  async function test(id, name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${id} - ${name}`);
      passed++;
    } catch (err) {
      console.log(`[FAIL] ${id} - ${name}: ${err.message}`);
      failed++;
    }
  }

  // TEST-01: 정상 상태 처리
  await test('TEST-01', TESTS[0].name, async () => {
    assert(typeof CircuitBreaker === 'function', 'CircuitBreaker 클래스가 구현되어야 함');
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 100 });
    const res = await cb.execute(async () => 200);
    assert.strictEqual(res, 200, '반환값이 200이어야 함');
    assert.strictEqual(cb.state, 'CLOSED', '초기 상태는 CLOSED여야 함');
    assert.strictEqual(cb.failureCount, 0, '정상 실행 시 failureCount는 0이어야 함');
  });

  // TEST-02: 단일 실패 카운팅
  await test('TEST-02', TESTS[1].name, async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 100 });
    let threw = false;
    try {
      await cb.execute(async () => { throw new Error('API 500'); });
    } catch (e) {
      threw = true;
      assert.strictEqual(e.message, 'API 500');
    }
    assert(threw, '원본 에러가 Throw되어야 함');
    assert.strictEqual(cb.state, 'CLOSED', '임계치 이전에는 CLOSED 유지');
    assert.strictEqual(cb.failureCount, 1, 'failureCount가 1로 증가해야 함');
  });

  // TEST-03: 임계치 도달 시 OPEN 전이
  await test('TEST-03', TESTS[2].name, async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 100 });
    const beforeChange = Date.now();
    for (let i = 0; i < 3; i++) {
      try {
        await cb.execute(async () => { throw new Error('fail'); });
      } catch (_) {}
    }
    assert.strictEqual(cb.state, 'OPEN', '임계치(3회) 도달 시 OPEN 상태로 전이되어야 함');
    assert(cb.lastStateChange >= beforeChange, 'lastStateChange 타임스탬프가 갱신되어야 함');
  });

  // TEST-04: OPEN 상태 빠른 실패 (Fail-Fast)
  await test('TEST-04', TESTS[3].name, async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 200 });
    try { await cb.execute(async () => { throw new Error('fail'); }); } catch (_) {}
    assert.strictEqual(cb.state, 'OPEN');

    let invoked = false;
    const start = performance.now();
    let threwExpected = false;
    try {
      await cb.execute(async () => {
        invoked = true;
        return 'unexpected';
      });
    } catch (e) {
      threwExpected = (e instanceof CircuitOpenError) || e.name === 'CircuitOpenError';
    }
    const elapsed = performance.now() - start;

    assert.strictEqual(invoked, false, 'OPEN 상태에서는 대상 함수를 호출하지 않아야 함');
    assert(threwExpected, 'CircuitOpenError가 발생해야 함');
    assert(elapsed < 15, `빠른 실패 소요시간이 15ms 미만이어야 함 (실측: ${elapsed}ms)`);
  });

  // TEST-05: 쿨다운 만료 후 HALF_OPEN 전이
  await test('TEST-05', TESTS[4].name, async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 50 });
    try { await cb.execute(async () => { throw new Error('fail'); }); } catch (_) {}
    assert.strictEqual(cb.state, 'OPEN');

    // 쿨다운 대기 (60ms)
    await new Promise((r) => setTimeout(r, 60));

    let probeRan = false;
    await cb.execute(async () => {
      probeRan = true;
      assert.strictEqual(cb.state, 'HALF_OPEN', '쿨다운 경과 후 호출 시 HALF_OPEN 상태여야 함');
      return 'probe-ok';
    });
    assert(probeRan, '탐침 요청이 실행되어야 함');
  });

  // TEST-06: HALF_OPEN 상태에서 성공 시 CLOSED 복구
  await test('TEST-06', TESTS[5].name, async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 50 });
    try { await cb.execute(async () => { throw new Error('fail'); }); } catch (_) {}
    await new Promise((r) => setTimeout(r, 60));

    // HALF_OPEN 상태에서 성공
    const res = await cb.execute(async () => 'recovered');
    assert.strictEqual(res, 'recovered');
    assert.strictEqual(cb.state, 'CLOSED', '성공 후 CLOSED로 완전 복구되어야 함');
    assert.strictEqual(cb.failureCount, 0, 'failureCount가 0으로 리셋되어야 함');
  });

  // TEST-07: HALF_OPEN 상태에서 실패 시 OPEN 재전이
  await test('TEST-07', TESTS[6].name, async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 50 });
    try { await cb.execute(async () => { throw new Error('fail'); }); } catch (_) {}
    await new Promise((r) => setTimeout(r, 60));

    // HALF_OPEN 상태에서 실패
    try {
      await cb.execute(async () => { throw new Error('probe-failed'); });
    } catch (_) {}

    assert.strictEqual(cb.state, 'OPEN', '탐침 실패 시 즉시 OPEN 상태로 재전이되어야 함');
  });

  // TEST-08: 지수 백오프 딜레이 계산
  await test('TEST-08', TESTS[7].name, async () => {
    assert(typeof calculateBackoff === 'function', 'calculateBackoff 함수가 구현되어야 함');
    // attempt 1 -> 100ms, attempt 2 -> 200ms, attempt 3 -> 400ms
    const d1 = calculateBackoff(1, 100, 1000);
    const d2 = calculateBackoff(2, 100, 1000);
    const d3 = calculateBackoff(3, 100, 1000);
    assert.strictEqual(d1, 100, `attempt 1은 100이어야 함 (실측: ${d1})`);
    assert.strictEqual(d2, 200, `attempt 2는 200이어야 함 (실측: ${d2})`);
    assert.strictEqual(d3, 400, `attempt 3은 400이어야 함 (실측: ${d3})`);
  });

  // TEST-09: 최대 백오프 상한선 제한
  await test('TEST-09', TESTS[8].name, async () => {
    assert(typeof calculateBackoff === 'function', 'calculateBackoff 함수가 구현되어야 함');
    const d10 = calculateBackoff(10, 100, 1000);
    assert.strictEqual(d10, 1000, `attempt 10은 maxDelay인 1000으로 제한되어야 함 (실측: ${d10})`);
  });

  // TEST-10: Dead Letter Queue (DLQ) 실패 페이로드 적재
  await test('TEST-10', TESTS[9].name, async () => {
    assert(typeof DeadLetterQueue === 'function', 'DeadLetterQueue 클래스가 구현되어야 함');
    const dlq = new DeadLetterQueue();
    assert.strictEqual(dlq.length, 0, '초기 DLQ 길이는 0');

    const error = new Error('Permanent Failure');
    dlq.push({ url: 'https://example.com/api' }, error);

    assert.strictEqual(dlq.length, 1, '적재 후 길이는 1이어야 함');
    const item = dlq.items[0];
    assert.deepStrictEqual(item.payload, { url: 'https://example.com/api' });
    assert.strictEqual(item.error.message, 'Permanent Failure');
    assert(typeof item.timestamp === 'string' || typeof item.timestamp === 'number', 'timestamp 필드 보존');
  });

  console.log('\n====================================================');
  console.log(` 검사 완료: ${passed} PASS / ${failed} FAIL (총 10개)`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAll().catch((err) => {
  console.error('Unhandled Test Runner Error:', err);
  process.exit(1);
});
