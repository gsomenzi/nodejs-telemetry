import { LoggerPort } from '../ports/logger.port';
import { ResolvedTelemetryConfig } from '../telemetry/config-validator';
import { LoggerService } from '../telemetry/logger-service';
import { StdoutLogSink } from './stdout-log-sink';

/**
 * ConsoleLogAdapter implements LoggerPort by writing structured JSON logs to stdout.
 *
 * Uses LoggerService for log level filtering, resource attributes, and correlation
 * context enrichment from the active trace span.
 */
export class ConsoleLogAdapter implements LoggerPort {
  private readonly loggerService: LoggerService;

  constructor(config: ResolvedTelemetryConfig) {
    const sink = new StdoutLogSink();
    this.loggerService = new LoggerService(config, (log) => sink.handle(log));
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.loggerService.debug(message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.loggerService.info(message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.loggerService.warn(message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.loggerService.error(message, context);
  }

  fatal(message: string, context?: Record<string, unknown>): void {
    this.loggerService.fatal(message, context);
  }
}
