export interface TelemetryConfig {
  serviceName: string;
  serviceVersion?: string;
  environment: string;
  logLevel?: LogLevel;
  exporter: ExporterConfig;
}

export interface ExporterConfig {
  endpoint: string;
  headers?: Record<string, string>;
  protocol?: 'http' | 'grpc';
  timeout?: number;
  retry?: RetryConfig;
}

export interface RetryConfig {
  maxAttempts: number;
  baseInterval: number;
  maxInterval: number;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface CorrelationContext {
  traceId: string;
  spanId: string;
  traceFlags?: number;
  traceState?: string;
}

export interface StructuredLog {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  resource: ResourceAttributes;
  correlation?: CorrelationContext;
}

export interface ResourceAttributes {
  'service.name': string;
  'service.version': string;
  'deployment.environment': string;
}

export interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  status: SpanStatus;
  startTime: string;
  endTime: string;
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
  resource: ResourceAttributes;
}

export interface SpanEvent {
  name: string;
  timestamp: string;
  attributes?: Record<string, unknown>;
}

export type SpanStatus = 'OK' | 'ERROR' | 'UNSET';

export type MetricType = 'counter' | 'histogram' | 'gauge';

export interface MetricDataPoint {
  name: string;
  type: MetricType;
  value: number;
  timestamp: string;
  attributes?: Record<string, string | number | boolean>;
  resource: ResourceAttributes;
}
