import { LoggerPort } from '../ports/logger.port';
import { TracerPort } from '../ports/tracer.port';
import { MetricsPort } from '../ports/metrics.port';
import { TelemetryConfig } from '../types';
import { ConfigValidator } from './config-validator';
import { OtlpLogExporter } from '../adapters/otlp-log-exporter';
import { OtlpTraceExporter } from '../adapters/otlp-trace-exporter';
import { OtlpMetricsExporter } from '../adapters/otlp-metrics-exporter';

/**
 * The result of TelemetryFactory.create() — provides access to all telemetry ports.
 */
export interface TelemetryInstance {
  logger: LoggerPort;
  tracer: TracerPort;
  metrics: MetricsPort;
}

/**
 * Internal interface for exporters that support shutdown.
 */
interface ShutdownableExporter {
  shutdown(): Promise<void>;
}

/**
 * Default shutdown timeout in milliseconds.
 * If exporters don't flush within this time, shutdown resolves anyway.
 */
const SHUTDOWN_TIMEOUT_MS = 5000;

/**
 * TelemetryFactory provides standalone (non-NestJS) usage of the telemetry library.
 *
 * - `create()` validates config and returns a TelemetryInstance with logger, tracer, metrics
 * - `shutdown()` gracefully flushes all pending data with a timeout; never throws
 *
 * Usage:
 * ```typescript
 * const telemetry = TelemetryFactory.create({
 *   serviceName: 'order-worker',
 *   environment: 'production',
 *   exporter: { endpoint: 'https://otlp.grafana.net/otlp', headers: { Authorization: '...' } },
 * });
 *
 * const { logger, tracer, metrics } = telemetry;
 * // ... use telemetry ...
 *
 * await TelemetryFactory.shutdown();
 * ```
 */
export class TelemetryFactory {
  private static exporters: ShutdownableExporter[] = [];

  /**
   * Creates a configured TelemetryInstance with logger, tracer, and metrics ports.
   *
   * Validates the provided config using ConfigValidator. Throws InvalidConfigurationError
   * if the config is invalid (fail-fast behavior).
   *
   * @param config - The telemetry configuration
   * @returns A TelemetryInstance with all three ports ready to use
   * @throws InvalidConfigurationError if config is invalid
   */
  static create(config: TelemetryConfig): TelemetryInstance {
    // Validate and resolve config (throws InvalidConfigurationError on bad config)
    const resolvedConfig = ConfigValidator.validate(config);

    // Create OTLP exporters wired with the resolved config
    const logExporter = new OtlpLogExporter(resolvedConfig);
    const traceExporter = new OtlpTraceExporter(resolvedConfig);
    const metricsExporter = new OtlpMetricsExporter(resolvedConfig);

    // Store references for shutdown
    TelemetryFactory.exporters.push(logExporter, traceExporter, metricsExporter);

    return {
      logger: logExporter,
      tracer: traceExporter,
      metrics: metricsExporter,
    };
  }

  /**
   * Gracefully shuts down all created exporters, flushing pending data.
   *
   * This method never throws. It applies a timeout to ensure shutdown completes
   * even if exporters are unresponsive. After shutdown, pending data is flushed
   * on a best-effort basis.
   */
  static async shutdown(): Promise<void> {
    try {
      const shutdownPromises = TelemetryFactory.exporters.map((exporter) =>
        exporter.shutdown().catch(() => {
          // Swallow individual exporter shutdown errors
        }),
      );

      // Race all shutdowns against a timeout
      await Promise.race([
        Promise.all(shutdownPromises),
        new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
      ]);
    } catch {
      // Never throw — best-effort shutdown
    } finally {
      // Clear references regardless of outcome
      TelemetryFactory.exporters = [];
    }
  }
}
