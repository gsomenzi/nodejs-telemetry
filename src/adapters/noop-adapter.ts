import { LoggerPort } from '../ports/logger.port';
import { TracerPort, SpanPort, SpanOptions } from '../ports/tracer.port';
import { MetricsPort } from '../ports/metrics.port';
import { NoopSpan } from '../telemetry/span';

/**
 * A no-op adapter that implements all telemetry ports (LoggerPort, TracerPort, MetricsPort).
 * All methods are safe no-ops — useful for testing or disabling telemetry entirely.
 */
export class NoopAdapter implements LoggerPort, TracerPort, MetricsPort {
  // LoggerPort methods

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

  // TracerPort methods

  startSpan(_name: string, _options?: SpanOptions): SpanPort {
    return new NoopSpan();
  }

  getActiveSpan(): SpanPort | null {
    return null;
  }

  // MetricsPort methods

  incrementCounter(
    _name: string,
    _value?: number,
    _attributes?: Record<string, string | number | boolean>,
  ): void {
    // no-op
  }

  recordHistogram(
    _name: string,
    _value: number,
    _attributes?: Record<string, string | number | boolean>,
  ): void {
    // no-op
  }

  recordGauge(
    _name: string,
    _value: number,
    _attributes?: Record<string, string | number | boolean>,
  ): void {
    // no-op
  }
}
