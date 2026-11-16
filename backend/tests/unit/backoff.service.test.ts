import { jest } from '@jest/globals';
import { backoffService } from '../../src/core/queue/backoff.service.js';

describe('BackoffService (Unit Tests)', () => {
  describe('Deterministic Exponential Backoff (No Jitter)', () => {
    it('should compute exact exponential progression with default factor 2', () => {
      const baseDelay = 1000;

      // Attempt 1: 1000 * 2^0 = 1000ms
      expect(backoffService.calculateDeterministicBackoff(1, { delayMs: baseDelay })).toBe(1000);

      // Attempt 2: 1000 * 2^1 = 2000ms
      expect(backoffService.calculateDeterministicBackoff(2, { delayMs: baseDelay })).toBe(2000);

      // Attempt 3: 1000 * 2^2 = 4000ms
      expect(backoffService.calculateDeterministicBackoff(3, { delayMs: baseDelay })).toBe(4000);

      // Attempt 4: 1000 * 2^3 = 8000ms
      expect(backoffService.calculateDeterministicBackoff(4, { delayMs: baseDelay })).toBe(8000);

      // Attempt 5: 1000 * 2^4 = 16000ms
      expect(backoffService.calculateDeterministicBackoff(5, { delayMs: baseDelay })).toBe(16000);
    });

    it('should cap retry delay at maxDelayMs', () => {
      const maxDelay = 10000; // 10 seconds
      const delay = backoffService.calculateDeterministicBackoff(15, {
        delayMs: 1000,
        maxDelayMs: maxDelay,
      });

      expect(delay).toBe(maxDelay);
    });

    it('should support custom base delay and factor', () => {
      const delay = backoffService.calculateDeterministicBackoff(3, {
        delayMs: 500,
        factor: 3, // 500 * 3^(3 - 1) = 500 * 9 = 4500ms
      });

      expect(delay).toBe(4500);
    });

    it('should handle edge cases like attempt <= 0 safely', () => {
      const delayZero = backoffService.calculateDeterministicBackoff(0, { delayMs: 1000 });
      const delayNegative = backoffService.calculateDeterministicBackoff(-5, { delayMs: 1000 });

      expect(delayZero).toBe(1000);
      expect(delayNegative).toBe(1000);
    });
  });

  describe('Full Randomized Jitter Backoff', () => {
    it('should produce delays bounded between 0 and calculated backoff ceiling', () => {
      const baseDelay = 1000;
      const ceilingAttempt3 = 1000 * Math.pow(2, 2); // 4000ms

      const samples: number[] = [];
      for (let i = 0; i < 50; i++) {
        const delay = backoffService.calculateBackoff(3, { delayMs: baseDelay, jitter: true });
        expect(delay).toBeGreaterThanOrEqual(50);
        expect(delay).toBeLessThanOrEqual(ceilingAttempt3);
        samples.push(delay);
      }

      // Check variance: with 50 samples, we should have multiple distinct values
      const distinctValues = new Set(samples);
      expect(distinctValues.size).toBeGreaterThan(10);
    });
  });

  describe('Fixed Backoff Strategy', () => {
    it('should return constant delay for fixed backoff type', () => {
      const fixedDelay = 2500;
      const delay1 = backoffService.calculateBackoff(1, { type: 'fixed', delayMs: fixedDelay, jitter: false });
      const delay5 = backoffService.calculateBackoff(5, { type: 'fixed', delayMs: fixedDelay, jitter: false });

      expect(delay1).toBe(fixedDelay);
      expect(delay5).toBe(fixedDelay);
    });
  });
});
