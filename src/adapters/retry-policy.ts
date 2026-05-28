import { RetryConfig } from '../types';

/**
 * Network error codes that are considered retryable.
 */
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ECONNRESET',
  'ENOTFOUND',
]);

/**
 * Calculates the delay in milliseconds for a given retry attempt using exponential backoff.
 * Formula: min(baseInterval * 2^(attempt-1), maxInterval)
 *
 * @param attempt - The current attempt number (1-based)
 * @param config - The retry configuration
 * @returns The delay in milliseconds before the next retry
 */
export function calculateDelay(attempt: number, config: RetryConfig): number {
  const delay = config.baseInterval * Math.pow(2, attempt - 1);
  return Math.min(delay, config.maxInterval);
}

/**
 * Determines whether a retry should be attempted based on the current attempt number.
 *
 * @param attempt - The current attempt number (1-based)
 * @param config - The retry configuration
 * @returns true if the attempt is less than maxAttempts (i.e., more retries are allowed)
 */
export function shouldRetry(attempt: number, config: RetryConfig): boolean {
  return attempt < config.maxAttempts;
}

/**
 * Determines whether an error is a retryable network error.
 * Checks for common Node.js network error codes: ECONNREFUSED, ETIMEDOUT, ECONNRESET, ENOTFOUND.
 *
 * @param error - The error to check
 * @returns true if the error is a retryable network error
 */
export function isRetryableError(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false;
  }

  if (typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') {
      return RETRYABLE_ERROR_CODES.has(code);
    }
  }

  return false;
}

/**
 * Executes an async function with retry logic using exponential backoff.
 * Only retries on retryable network errors.
 * After all retries are exhausted, logs the error to console and returns undefined.
 *
 * @param fn - The async function to execute
 * @param config - The retry configuration
 * @returns The result of the function, or undefined if all retries are exhausted
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
): Promise<T | undefined> {
  let attempt = 1;

  while (true) {
    try {
      return await fn();
    } catch (error: unknown) {
      if (!isRetryableError(error) || !shouldRetry(attempt, config)) {
        console.error(
          `[Telemetry] Export failed after ${attempt} attempt(s). Data discarded.`,
          error,
        );
        return undefined;
      }

      const delay = calculateDelay(attempt, config);
      await sleep(delay);
      attempt++;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
