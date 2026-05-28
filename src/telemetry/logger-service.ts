import { LoggerPort } from '../ports/logger.port';
import { ContextManager, contextManager } from './context-manager';
import { ResolvedTelemetryConfig } from './config-validator';
import { LogLevel, StructuredLog, ResourceAttributes, CorrelationContext } from '../types';

/**
 * Severity ordering for log levels.
 * Higher number = higher severity.
 */
const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

export type LogHandler = (log: StructuredLog) => void;

/**
 * LoggerService implements LoggerPort with:
 * - Automatic correlation context enrichment from ContextManager
 * - Log level filtering based on configured minimum level
 * - Structured log building with timestamp, level, message, context, resource, correlation
 * - Fail-safe methods that never throw to the caller
 */
export class LoggerService implements LoggerPort {
  private readonly resource: ResourceAttributes;
  private readonly minSeverity: number;
  private readonly logBuffer: StructuredLog[] = [];
  private readonly logHandler?: LogHandler;

  constructor(
    private readonly config: ResolvedTelemetryConfig,
    logHandler?: LogHandler,
  ) {
    this.resource = {
      'service.name': config.serviceName,
      'service.version': config.serviceVersion,
      'deployment.environment': config.environment,
    };
    this.minSeverity = LOG_LEVEL_SEVERITY[config.logLevel];
    this.logHandler = logHandler;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  fatal(message: string, context?: Record<string, unknown>): void {
    this.log('fatal', message, context);
  }

  /**
   * Returns the internal log buffer for testing or adapter retrieval.
   */
  getLogBuffer(): StructuredLog[] {
    return this.logBuffer;
  }

  /**
   * Clears the internal log buffer.
   */
  clearLogBuffer(): void {
    this.logBuffer.length = 0;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    try {
      // Filter: discard logs below configured minimum level
      if (LOG_LEVEL_SEVERITY[level] < this.minSeverity) {
        return;
      }

      // Build correlation from active context
      const correlation = contextManager.getCorrelationContext() ?? undefined;

      // Build structured log
      const structuredLog: StructuredLog = {
        timestamp: new Date().toISOString(),
        level,
        message,
        context,
        resource: this.resource,
        correlation,
      };

      // Pass to handler if provided, otherwise buffer internally
      if (this.logHandler) {
        this.logHandler(structuredLog);
      } else {
        this.logBuffer.push(structuredLog);
      }
    } catch (err) {
      // Never throw to the caller — swallow errors and log to console
      try {
        console.error('[LoggerService] Internal error while logging:', err);
      } catch {
        // Even console.error could theoretically fail — swallow silently
      }
    }
  }
}
