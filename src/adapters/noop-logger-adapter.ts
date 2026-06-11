import { LoggerPort } from '../ports/logger.port';

/**
 * No-op logger adapter. All log methods are safe no-ops.
 * Useful for disabling log output while keeping traces and metrics active.
 */
export class NoopLoggerAdapter implements LoggerPort {
  debug(_message: string, _context?: Record<string, unknown>): void {
    // no-op
  }

  info(_message: string, _context?: Record<string, unknown>): void {
    // no-op
  }

  warn(_message: string, _context?: Record<string, unknown>): void {
    // no-op
  }

  error(_message: string, _context?: Record<string, unknown>): void {
    // no-op
  }

  fatal(_message: string, _context?: Record<string, unknown>): void {
    // no-op
  }
}
