// Ports
export type { LoggerPort } from './ports/logger.port';
export { LOGGER_PORT } from './ports/logger.port';
export type { TracerPort, SpanPort, SpanOptions } from './ports/tracer.port';
export { TRACER_PORT } from './ports/tracer.port';
export type { MetricsPort } from './ports/metrics.port';
export { METRICS_PORT } from './ports/metrics.port';
export type { ContextPropagatorPort } from './ports/context-propagator.port';
export type { MessageContextHandlerPort } from './ports/message-context-handler.port';

// Types
export type {
  TelemetryConfig,
  ExporterConfig,
  RetryConfig,
  LogLevel,
  CorrelationContext,
  StructuredLog,
  ResourceAttributes,
  SpanData,
  SpanEvent,
  SpanStatus,
  MetricDataPoint,
  MetricType,
} from './types';

// Adapters
export { ConsoleLogAdapter } from './adapters/console-log-adapter';
export { NoopAdapter } from './adapters/noop-adapter';
export { ContextPropagator } from './adapters/context-propagator';
export { OtlpLogExporter } from './adapters/otlp-log-exporter';
export { OtlpTraceExporter } from './adapters/otlp-trace-exporter';
export { OtlpMetricsExporter } from './adapters/otlp-metrics-exporter';
export { TelemetryContextHandler } from './adapters/telemetry-context-handler';
export { calculateDelay, shouldRetry, isRetryableError, executeWithRetry } from './adapters/retry-policy';

// Errors
export { TelemetryError } from './errors/telemetry.error';
export { ExporterConnectionError } from './errors/exporter-connection.error';
export { ExporterTimeoutError } from './errors/exporter-timeout.error';
export { InvalidConfigurationError } from './errors/invalid-configuration.error';
export { SpanContextError } from './errors/span-context.error';

// Core — TelemetryFactory and TelemetryInstance
export { TelemetryFactory } from './telemetry/telemetry-factory';
export type { TelemetryInstance } from './telemetry/telemetry-factory';

// Core — ConfigValidator and ResolvedTelemetryConfig
export { ConfigValidator } from './telemetry/config-validator';
export type { ResolvedTelemetryConfig, ResolvedExporterConfig } from './telemetry/config-validator';
