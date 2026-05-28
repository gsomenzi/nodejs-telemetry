import { MetricsPort } from '../ports/metrics.port';
import { ResolvedTelemetryConfig } from './config-validator';
import { MetricDataPoint, MetricType, ResourceAttributes } from '../types';

export type MetricHandler = (metric: MetricDataPoint) => void;

/**
 * MetricsService implements MetricsPort with:
 * - Resource attributes (service.name, service.version, deployment.environment) attached to all metrics
 * - Internal buffer for periodic flush by the adapter
 * - Fail-safe methods that never throw to the caller
 */
export class MetricsService implements MetricsPort {
  private readonly resource: ResourceAttributes;
  private readonly metricBuffer: MetricDataPoint[] = [];
  private readonly metricHandler?: MetricHandler;

  constructor(
    private readonly config: ResolvedTelemetryConfig,
    metricHandler?: MetricHandler,
  ) {
    this.resource = {
      'service.name': config.serviceName,
      'service.version': config.serviceVersion,
      'deployment.environment': config.environment,
    };
    this.metricHandler = metricHandler;
  }

  incrementCounter(
    name: string,
    value?: number,
    attributes?: Record<string, string | number | boolean>,
  ): void {
    this.recordMetric('counter', name, value ?? 1, attributes);
  }

  recordHistogram(
    name: string,
    value: number,
    attributes?: Record<string, string | number | boolean>,
  ): void {
    this.recordMetric('histogram', name, value, attributes);
  }

  recordGauge(
    name: string,
    value: number,
    attributes?: Record<string, string | number | boolean>,
  ): void {
    this.recordMetric('gauge', name, value, attributes);
  }

  /**
   * Returns the internal metric buffer for testing or adapter retrieval.
   */
  getMetricBuffer(): MetricDataPoint[] {
    return this.metricBuffer;
  }

  /**
   * Clears the internal metric buffer.
   */
  clearMetricBuffer(): void {
    this.metricBuffer.length = 0;
  }

  private recordMetric(
    type: MetricType,
    name: string,
    value: number,
    attributes?: Record<string, string | number | boolean>,
  ): void {
    try {
      const dataPoint: MetricDataPoint = {
        name,
        type,
        value,
        timestamp: new Date().toISOString(),
        attributes,
        resource: this.resource,
      };

      // Pass to handler if provided, otherwise buffer internally
      if (this.metricHandler) {
        this.metricHandler(dataPoint);
      } else {
        this.metricBuffer.push(dataPoint);
      }
    } catch (err) {
      // Never throw to the caller — swallow errors and log to console
      try {
        console.error('[MetricsService] Internal error while recording metric:', err);
      } catch {
        // Even console.error could theoretically fail — swallow silently
      }
    }
  }
}
