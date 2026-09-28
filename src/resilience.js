'use strict';

/**
 * 서킷 브레이커 OPEN 상태 시 호출을 차단하고 즉시 던지는 에러
 */
export class CircuitOpenError extends Error {
  constructor(message = 'Circuit breaker is OPEN') {
    super(message);
    this.name = 'CircuitOpenError';
  }
}

/**
 * 외부 의존성 장애 격리를 위한 서킷 브레이커 코어 상태머신
 * 
 * 상태 전이 규칙:
 * - CLOSED: 정상 요청 처리, 실패 횟수가 임계치(failureThreshold) 이상 누적되면 OPEN으로 전이
 * - OPEN: 모든 요청을 차단하고 즉시 CircuitOpenError 발생(Fail-Fast), 쿨다운 경과 시 최초 요청을 HALF_OPEN으로 전이하여 탐침
 * - HALF_OPEN: 복구 검증 상태 (AI B에서 성공 시 CLOSED 복구 및 실패 시 OPEN 재전이 구현 예정)
 */
export class CircuitBreaker {
  /**
   * @param {Object} options
   * @param {number} [options.failureThreshold=5] OPEN 전이 실패 횟수 임계치
   * @param {number} [options.cooldownMs=10000] OPEN 후 HALF_OPEN 전이까지의 쿨다운 시간(ms)
   */
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 10000;
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastStateChange = Date.now();
  }

  /**
   * 보호 대상 비동기 함수 실행 및 상태 전이 관리
   * @template T
   * @param {() => Promise<T>} fn 실행 대상 함수
   * @returns {Promise<T>}
   */
  async execute(fn) {
    if (this.state === 'OPEN') {
      const now = Date.now();
      if (now - this.lastStateChange >= this.cooldownMs) {
        this.state = 'HALF_OPEN';
        this.lastStateChange = now;
      } else {
        throw new CircuitOpenError();
      }
    }

    if (this.state === 'HALF_OPEN') {
      try {
        const result = await fn();
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.lastStateChange = Date.now();
        return result;
      } catch (err) {
        this.state = 'OPEN';
        this.lastStateChange = Date.now();
        throw err;
      }
    }

    // CLOSED 상태 실행 및 연속 실패 카운팅
    try {
      return await fn();
    } catch (err) {
      this.failureCount++;
      if (this.failureCount >= this.failureThreshold) {
        this.state = 'OPEN';
        this.lastStateChange = Date.now();
      }
      throw err;
    }
  }
}

/** Calculate the capped exponential delay for a 1-indexed retry attempt. */
export function calculateBackoff(attempt, baseDelay, maxDelay) {
  return Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
}

/** In-memory store for payloads that have exhausted their retry attempts. */
export class DeadLetterQueue {
  constructor() {
    this.items = [];
  }

  get length() {
    return this.items.length;
  }

  push(payload, error) {
    this.items.push({ payload, error, timestamp: Date.now() });
  }
}
