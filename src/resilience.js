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
      // AI A 작업 범위: 쿨다운 경과 후 HALF_OPEN 전이 및 단일 탐침 요청 실행까지만 담당 (TEST-05 통과)
      // TEST-06(성공 시 CLOSED 복구) 및 TEST-07(실패 시 OPEN 재전이)은 AI B 작업 범위로 의도적 미처리
      return await fn();
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

// AI B 구현 대상: 지수 백오프 및 DLQ 엔진 (TEST-08 ~ TEST-10 대상, 현재 undefined)
export const calculateBackoff = undefined;
export const DeadLetterQueue = undefined;
