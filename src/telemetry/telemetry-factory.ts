import { LoggerPort } from '../ports/logger.port';
import { TracerPort } from '../ports/tracer.port';
import { MetricsPort } from '../ports/metrics.port';
import { TelemetryConfig } from '../types';
import { ConfigValidator } from './config-validator';
import { OtlpTraceExporter } from '../adapters/otlp-trace-exporter';
import { OtlpMetricsExporter } from '../adapters/otlp-metrics-exporter';
import { registerGlobalTracer, shutdownGlobalTracer } from './global-tracer-registration';
import {
  createLoggerAdapter,
  isShutdownableLogger,
} from './logger-adapter.factory';

/**
 * The result of TelemetryFactory.create() — provides access to all telemetry ports.
 */
export interface TelemetryInstance {
  logger: LoggerPort;
  tracer: TracerPort;
  metrics: MetricsPort;
}

/**
 * Optional overrides for TelemetryFactory.create().
 */
export interface TelemetryFactoryOptions {
  /** Custom logger implementation — takes precedence over `loggerAdapter` from config. */
  logger?: LoggerPort;
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
 *   loggerAdapter: 'console',
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
   * @param options - Optional overrides (e.g. custom logger)
   * @returns A TelemetryInstance with all three ports ready to use
   * @throws InvalidConfigurationError if config is invalid
   */
  static create(config: TelemetryConfig, options?: TelemetryFactoryOptions): TelemetryInstance {
    // Validate and resolve config (throws InvalidConfigurationError on bad config)
    const resolvedConfig = ConfigValidator.validate(config);

    // Register global TracerProvider and W3CTraceContextPropagator with @opentelemetry/api.
    // This enables interoperability with any library that uses the OTel API
    // (e.g., propagation.inject() in messaging libs will produce valid traceparent headers).
    registerGlobalTracer(resolvedConfig);

    const logger = createLoggerAdapter(resolvedConfig, {
      adapter: config.loggerAdapter,
      logger: options?.logger,
    });
    const traceExporter = new OtlpTraceExporter(resolvedConfig);
    const metricsExporter = new OtlpMetricsExporter(resolvedConfig);

    // Store references for shutdown (only shutdownable exporters)
    if (isShutdownableLogger(logger)) {
      TelemetryFactory.exporters.push(logger);
    }
    TelemetryFactory.exporters.push(traceExporter, metricsExporter);

    return {
      logger,
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

      // Also shutdown the global TracerProvider (flushes OTel SDK spans)
      shutdownPromises.push(
        shutdownGlobalTracer().catch(() => {
          // Swallow global provider shutdown errors
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
