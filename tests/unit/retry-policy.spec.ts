import {
  calculateDelay,
  shouldRetry,
  isRetryableError,
  executeWithRetry,
} from '../../src/adapters/retry-policy';
import { RetryConfig } from '../../src/types';

describe('RetryPolicy', () => {
  const defaultConfig: RetryConfig = {
    maxAttempts: 3,
    baseInterval: 1000,
    maxInterval: 60000,
  };

  describe('calculateDelay', () => {
    it('should return baseInterval for the first attempt', () => {
      expect(calculateDelay(1, defaultConfig)).toBe(1000);
    });

    it('should double the delay for each subsequent attempt', () => {
      expect(calculateDelay(2, defaultConfig)).toBe(2000);
      expect(calculateDelay(3, defaultConfig)).toBe(4000);
      expect(calculateDelay(4, defaultConfig)).toBe(8000);
    });

    it('should cap the delay at maxInterval', () => {
      const config: RetryConfig = {
        maxAttempts: 10,
        baseInterval: 1000,
        maxInterval: 5000,
      };
      expect(calculateDelay(5, config)).toBe(5000); // 1000 * 2^4 = 16000, capped at 5000
      expect(calculateDelay(10, config)).toBe(5000);
    });

    it('should handle baseInterval equal to maxInterval', () => {
      const config: RetryConfig = {
        maxAttempts: 3,
        baseInterval: 5000,
        maxInterval: 5000,
      };
      expect(calculateDelay(1, config)).toBe(5000);
      expect(calculateDelay(2, config)).toBe(5000);
    });
  });

  describe('shouldRetry', () => {
    it('should return true when attempt is less than maxAttempts', () => {
      expect(shouldRetry(1, defaultConfig)).toBe(true);
      expect(shouldRetry(2, defaultConfig)).toBe(true);
    });

    it('should return false when attempt equals maxAttempts', () => {
      expect(shouldRetry(3, defaultConfig)).toBe(false);
    });

    it('should return false when attempt exceeds maxAttempts', () => {
      expect(shouldRetry(4, defaultConfig)).toBe(false);
    });

    it('should return false when maxAttempts is 1 and attempt is 1', () => {
      const config: RetryConfig = { maxAttempts: 1, baseInterval: 1000, maxInterval: 60000 };
      expect(shouldRetry(1, config)).toBe(false);
    });
  });

  describe('isRetryableError', () => {
    it('should return true for ECONNREFUSED', () => {
      const error = Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' });
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for ETIMEDOUT', () => {
      const error = Object.assign(new Error('Timed out'), { code: 'ETIMEDOUT' });
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for ECONNRESET', () => {
      const error = Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' });
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for ENOTFOUND', () => {
      const error = Object.assign(new Error('Not found'), { code: 'ENOTFOUND' });
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return false for non-network errors', () => {
      const error = new Error('Some other error');
      expect(isRetryableError(error)).toBe(false);
    });

    it('should return false for errors with unknown codes', () => {
      const error = Object.assign(new Error('Unknown'), { code: 'EUNKNOWN' });
      expect(isRetryableError(error)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isRetryableError(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isRetryableError(undefined)).toBe(false);
    });

    it('should return false for non-object values', () => {
      expect(isRetryableError('string error')).toBe(false);
      expect(isRetryableError(42)).toBe(false);
    });

    it('should return false for objects with non-string code', () => {
      const error = { code: 123 };
      expect(isRetryableError(error)).toBe(false);
    });
  });

  describe('executeWithRetry', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    it('should return the result on first successful attempt', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const result = await executeWithRetry(fn, defaultConfig);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable errors and succeed', async () => {
      const networkError = Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' });
      const fn = jest.fn()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce('success');

      const promise = executeWithRetry(fn, defaultConfig);
      await jest.advanceTimersByTimeAsync(1000);
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should return undefined after all retries are exhausted', async () => {
      const networkError = Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' });
      const fn = jest.fn().mockRejectedValue(networkError);

      const promise = executeWithRetry(fn, defaultConfig);
      await jest.advanceTimersByTimeAsync(1000); // attempt 1 -> retry after 1000ms
      await jest.advanceTimersByTimeAsync(2000); // attempt 2 -> retry after 2000ms
      const result = await promise;

      expect(result).toBeUndefined();
      expect(fn).toHaveBeenCalledTimes(3);
      expect(console.error).toHaveBeenCalled();
    });

    it('should not retry on non-retryable errors', async () => {
      const error = new Error('Not a network error');
      const fn = jest.fn().mockRejectedValue(error);

      const result = await executeWithRetry(fn, defaultConfig);

      expect(result).toBeUndefined();
      expect(fn).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalled();
    });

    it('should apply exponential backoff between retries', async () => {
      const networkError = Object.assign(new Error('Timed out'), { code: 'ETIMEDOUT' });
      const fn = jest.fn()
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce('success');

      const promise = executeWithRetry(fn, defaultConfig);

      // First retry after 1000ms (baseInterval * 2^0)
      await jest.advanceTimersByTimeAsync(1000);
      expect(fn).toHaveBeenCalledTimes(2);

      // Second retry after 2000ms (baseInterval * 2^1)
      await jest.advanceTimersByTimeAsync(2000);
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });
});
