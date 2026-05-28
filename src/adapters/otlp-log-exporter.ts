import { LoggerPort } from '../ports/logger.port';
import { ResolvedTelemetryConfig, ResolvedExporterConfig } from '../telemetry/config-validator';
import { contextManager } from '../telemetry/context-manager';
import { executeWithRetry } from './retry-policy';
import {
  LogLevel,
  StructuredLog,
  ResourceAttributes,
  CorrelationContext,
} from '../types';

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

/**
 * Maps LogLevel to OTLP SeverityNumber as defined by the OpenTelemetry specification.
 * @see https://opentelemetry.io/docs/specs/otel/logs/data-model/#severity-fields
 */
const OTLP_SEVERITY_NUMBER: Record<LogLevel, number> = {
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
};

/**
 * Maps LogLevel to OTLP SeverityText.
 */
const OTLP_SEVERITY_TEXT: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
  fatal: 'FATAL',
};

/**
 * OtlpLogExporter implements LoggerPort and sends structured logs to an OTLP-compatible
 * endpoint via HTTP. It uses Node.js built-in fetch (Node 18+) for HTTP requests.
 *
 * Features:
 * - Implements LoggerPort interface (debug, info, warn, error, fatal)
 * - Builds structured logs with correlation context from ContextManager
 * - Batches logs internally and flushes periodically or on demand
 * - Authenticates requests using configured headers
 * - Retries on transient network failures with exponential backoff
 * - On failure after all retries: discards data + console.error
 * - Methods never throw to the caller
 */
export class OtlpLogExporter implements LoggerPort {
  private readonly resource: ResourceAttributes;
  private readonly minSeverity: number;
  private readonly exporterConfig: ResolvedExporterConfig;
  private readonly logBuffer: StructuredLog[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;
  private isShuttingDown = false;

  constructor(
    private readonly config: ResolvedTelemetryConfig,
    options?: { flushIntervalMs?: number; maxBatchSize?: number },
  ) {
    this.resource = {
      'service.name': config.serviceName,
      'service.version': config.serviceVersion,
      'deployment.environment': config.environment,
    };
    this.minSeverity = LOG_LEVEL_SEVERITY[config.logLevel];
    this.exporterConfig = config.exporter;
    this.flushIntervalMs = options?.flushIntervalMs ?? 5000;
    this.maxBatchSize = options?.maxBatchSize ?? 100;

    this.startPeriodicFlush();
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
   * Flushes all buffered logs to the OTLP endpoint.
   * Called periodically and on shutdown.
   */
  async flush(): Promise<void> {
    if (this.logBuffer.length === 0) {
      return;
    }

    const batch = this.logBuffer.splice(0, this.logBuffer.length);
    await this.exportBatch(batch);
  }

  /**
   * Gracefully shuts down the exporter: stops periodic flush, flushes remaining logs.
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    this.stopPeriodicFlush();

    try {
      await this.flush();
    } catch {
      // Never throw on shutdown — best-effort flush
    }
  }

  /**
   * Returns the number of buffered logs (useful for testing).
   */
  getBufferSize(): number {
    return this.logBuffer.length;
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

      this.logBuffer.push(structuredLog);

      // Flush immediately if batch size reached
      if (this.logBuffer.length >= this.maxBatchSize) {
        void this.flush();
      }
    } catch {
      // Never throw to the caller — swallow errors silently
    }
  }

  private async exportBatch(batch: StructuredLog[]): Promise<void> {
    const payload = this.buildOtlpPayload(batch);
    const endpoint = this.getLogsEndpoint();
    const headers = this.buildHeaders();

    await executeWithRetry(async () => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.exporterConfig.timeout),
      });

      if (!response.ok) {
        const error = new Error(
          `OTLP export failed with status ${response.status}: ${response.statusText}`,
        );
        // Treat 5xx and 429 as retryable
        if (response.status >= 500 || response.status === 429) {
          (error as NodeJS.ErrnoException).code = 'ECONNRESET';
        }
        throw error;
      }
    }, this.exporterConfig.retry);
  }

  /**
   * Builds the OTLP JSON payload for a batch of logs following the OTLP/HTTP JSON format.
   * @see https://opentelemetry.io/docs/specs/otlp/#otlphttp
   */
  private buildOtlpPayload(batch: StructuredLog[]): OtlpLogsPayload {
    const logRecords: OtlpLogRecord[] = batch.map((log) => {
      const record: OtlpLogRecord = {
        timeUnixNano: this.isoToNano(log.timestamp),
        severityNumber: OTLP_SEVERITY_NUMBER[log.level],
        severityText: OTLP_SEVERITY_TEXT[log.level],
        body: { stringValue: log.message },
        attributes: this.buildAttributes(log.context),
      };

      if (log.correlation) {
        record.traceId = log.correlation.traceId;
        record.spanId = log.correlation.spanId;
        if (log.correlation.traceFlags !== undefined) {
          record.flags = log.correlation.traceFlags;
        }
      }

      return record;
    });

    return {
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: this.resource['service.name'] } },
              { key: 'service.version', value: { stringValue: this.resource['service.version'] } },
              {
                key: 'deployment.environment',
                value: { stringValue: this.resource['deployment.environment'] },
              },
            ],
          },
          scopeLogs: [
            {
              scope: { name: '@gsomenzi/nodejs-telemetry' },
              logRecords,
            },
          ],
        },
      ],
    };
  }

  private buildAttributes(
    context?: Record<string, unknown>,
  ): OtlpAttribute[] {
    if (!context) {
      return [];
    }

    return Object.entries(context).map(([key, value]) => ({
      key,
      value: this.toOtlpValue(value),
    }));
  }

  private toOtlpValue(value: unknown): OtlpAnyValue {
    if (typeof value === 'string') {
      return { stringValue: value };
    }
    if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        return { intValue: value };
      }
      return { doubleValue: value };
    }
    if (typeof value === 'boolean') {
      return { boolValue: value };
    }
    // Fallback: serialize as string
    return { stringValue: String(value) };
  }

  private isoToNano(isoTimestamp: string): string {
    const ms = new Date(isoTimestamp).getTime();
    // Convert milliseconds to nanoseconds (as string to avoid precision loss)
    return (BigInt(ms) * BigInt(1_000_000)).toString();
  }

  private getLogsEndpoint(): string {
    const base = this.exporterConfig.endpoint.replace(/\/$/, '');
    // If the endpoint already contains /v1/logs, use as-is
    if (base.endsWith('/v1/logs')) {
      return base;
    }
    return `${base}/v1/logs`;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.exporterConfig.headers) {
      Object.assign(headers, this.exporterConfig.headers);
    }

    return headers;
  }

  private startPeriodicFlush(): void {
    this.flushTimer = setInterval(() => {
      if (!this.isShuttingDown) {
        void this.flush();
      }
    }, this.flushIntervalMs);

    // Unref the timer so it doesn't prevent process exit
    if (this.flushTimer && typeof this.flushTimer.unref === 'function') {
      this.flushTimer.unref();
    }
  }

  private stopPeriodicFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

// OTLP JSON types (subset needed for log export)

interface OtlpLogsPayload {
  resourceLogs: OtlpResourceLogs[];
}

interface OtlpResourceLogs {
  resource: {
    attributes: OtlpAttribute[];
  };
  scopeLogs: OtlpScopeLogs[];
}

interface OtlpScopeLogs {
  scope: { name: string };
  logRecords: OtlpLogRecord[];
}

interface OtlpLogRecord {
  timeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: OtlpAnyValue;
  attributes: OtlpAttribute[];
  traceId?: string;
  spanId?: string;
  flags?: number;
}

interface OtlpAttribute {
  key: string;
  value: OtlpAnyValue;
}

interface OtlpAnyValue {
  stringValue?: string;
  intValue?: number;
  doubleValue?: number;
  boolValue?: boolean;
}
