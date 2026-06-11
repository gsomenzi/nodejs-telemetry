import { LoggerPort } from '../ports/logger.port';
import { ConsoleLogAdapter } from '../adapters/console-log-adapter';
import { NoopLoggerAdapter } from '../adapters/noop-logger-adapter';
import { OtlpLogExporter } from '../adapters/otlp-log-exporter';
import { ResolvedTelemetryConfig } from './config-validator';
import { LoggerAdapterType } from '../types';

export interface CreateLoggerAdapterOptions {
  /** Built-in adapter type. Defaults to 'otlp'. */
  adapter?: LoggerAdapterType;
  /** Custom logger implementation — takes precedence over `adapter`. */
  logger?: LoggerPort;
}

/**
 * Creates a LoggerPort implementation based on the selected adapter type.
 *
 * Built-in adapters:
 * - `otlp` — sends structured logs to an OTLP-compatible endpoint (default)
 * - `console` — writes structured JSON logs to stdout
 * - `noop` — discards all log output
 */
export function createLoggerAdapter(
  config: ResolvedTelemetryConfig,
  options?: LoggerAdapterType | CreateLoggerAdapterOptions,
): LoggerPort {
  const resolvedOptions = normalizeOptions(options);

  if (resolvedOptions.logger) {
    return resolvedOptions.logger;
  }

  switch (resolvedOptions.adapter ?? 'otlp') {
    case 'console':
      return new ConsoleLogAdapter(config);
    case 'noop':
      return new NoopLoggerAdapter();
    case 'otlp':
    default:
      return new OtlpLogExporter(config);
  }
}

/**
 * Returns true when the logger supports graceful shutdown (e.g. OTLP flush).
 */
export function isShutdownableLogger(
  logger: LoggerPort,
): logger is LoggerPort & { shutdown(): Promise<void> } {
  return (
    typeof (logger as LoggerPort & { shutdown?: () => Promise<void> }).shutdown === 'function'
  );
}

function normalizeOptions(
  options?: LoggerAdapterType | CreateLoggerAdapterOptions,
): CreateLoggerAdapterOptions {
  if (options === undefined) {
    return {};
  }

  if (typeof options === 'string') {
    return { adapter: options };
  }

  return options;
}
