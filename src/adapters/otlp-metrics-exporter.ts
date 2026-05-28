import { MetricsPort } from '../ports/metrics.port';
import { MetricDataPoint, MetricType, ResourceAttributes } from '../types';
import { ResolvedTelemetryConfig } from '../telemetry/config-validator';
import { executeWithRetry } from './retry-policy';

/**
 * OTLP Metrics Exporter that implements MetricsPort.
 *
 * Buffers metric data points internally and flushes them periodically
 * to the configured OTLP endpoint. Uses retry logic with exponential
 * backoff for transient network failures.
 *
 * All public MetricsPort methods are fail-safe and never throw.
 */
export class OtlpMetricsExporter implements MetricsPort {
  private readonly resource: ResourceAttributes;
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly timeout: number;
  private readonly config: ResolvedTelemetryConfig;
  private readonly buffer: MetricDataPoint[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private isShutdown = false;

  private static readonly FLUSH_INTERVAL_MS = 60_000;

  constructor(config: ResolvedTelemetryConfig) {
    this.config = config;
    this.resource = {
      'service.name': config.serviceName,
      'service.version': config.serviceVersion,
      'deployment.environment': config.environment,
    };

    // Normalize endpoint: remove trailing slash, append /v1/metrics
    const baseEndpoint = config.exporter.endpoint.replace(/\/+$/, '');
    this.endpoint = `${baseEndpoint}/v1/metrics`;

    this.headers = {
      'Content-Type': 'application/json',
      ...(config.exporter.headers ?? {}),
    };

    this.timeout = config.exporter.timeout;

    this.startPeriodicFlush();
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
   * Flushes all buffered metrics to the OTLP endpoint.
   * Returns a promise that resolves when the flush attempt completes.
   * Never throws — errors are logged to console and data is discarded.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    // Drain the buffer atomically
    const metrics = this.buffer.splice(0, this.buffer.length);

    try {
      const payload = this.serializeMetrics(metrics);

      await executeWithRetry(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
          const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: this.headers,
            body: payload,
            signal: controller.signal,
          });

          if (!response.ok) {
            const error = new Error(
              `OTLP metrics export failed with status ${response.status}`,
            );
            (error as NodeJS.ErrnoException).code = 'ECONNREFUSED';
            throw error;
          }
        } finally {
          clearTimeout(timeoutId);
        }
      }, this.config.exporter.retry);
    } catch (err) {
      // Never throw to the caller — log and discard
      try {
        console.error('[OtlpMetricsExporter] Failed to flush metrics:', err);
      } catch {
        // Swallow silently
      }
    }
  }

  /**
   * Gracefully shuts down the exporter: stops the periodic flush timer
   * and performs a final flush of any buffered metrics.
   * Never throws.
   */
  async shutdown(): Promise<void> {
    this.isShutdown = true;
    this.stopPeriodicFlush();

    try {
      await this.flush();
    } catch {
      // Never throw on shutdown
    }
  }

  /**
   * Returns the current buffer size (useful for testing).
   */
  getBufferSize(): number {
    return this.buffer.length;
  }

  private recordMetric(
    type: MetricType,
    name: string,
    value: number,
    attributes?: Record<string, string | number | boolean>,
  ): void {
    if (this.isShutdown) {
      return;
    }

    try {
      const dataPoint: MetricDataPoint = {
        name,
        type,
        value,
        timestamp: new Date().toISOString(),
        attributes,
        resource: this.resource,
      };

      this.buffer.push(dataPoint);
    } catch (err) {
      // Never throw to the caller
      try {
        console.error('[OtlpMetricsExporter] Error recording metric:', err);
      } catch {
        // Swallow silently
      }
    }
  }

  private startPeriodicFlush(): void {
    this.flushInterval = setInterval(() => {
      void this.flush();
    }, OtlpMetricsExporter.FLUSH_INTERVAL_MS);

    // Allow the process to exit even if the interval is active
    if (this.flushInterval.unref) {
      this.flushInterval.unref();
    }
  }

  private stopPeriodicFlush(): void {
    if (this.flushInterval !== null) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }

  /**
   * Serializes metric data points into OTLP JSON format.
   * Follows a simplified OTLP metrics structure.
   */
  private serializeMetrics(metrics: MetricDataPoint[]): string {
    const resourceMetrics = {
      resourceMetrics: [
        {
          resource: {
            attributes: this.resourceToAttributes(metrics[0]?.resource ?? this.resource),
          },
          scopeMetrics: [
            {
              scope: {
                name: '@gsomenzi/nodejs-telemetry',
                version: this.config.serviceVersion,
              },
              metrics: metrics.map((m) => this.metricToOtlp(m)),
            },
          ],
        },
      ],
    };

    return JSON.stringify(resourceMetrics);
  }

  private metricToOtlp(metric: MetricDataPoint): object {
    const dataPoint = {
      attributes: metric.attributes
        ? Object.entries(metric.attributes).map(([key, value]) => ({
            key,
            value: this.toAnyValue(value),
          }))
        : [],
      timeUnixNano: this.isoToNano(metric.timestamp),
      asDouble: metric.value,
    };

    switch (metric.type) {
      case 'counter':
        return {
          name: metric.name,
          sum: {
            dataPoints: [{ ...dataPoint, startTimeUnixNano: dataPoint.timeUnixNano }],
            aggregationTemporality: 2, // AGGREGATION_TEMPORALITY_CUMULATIVE
            isMonotonic: true,
          },
        };
      case 'histogram':
        return {
          name: metric.name,
          histogram: {
            dataPoints: [
              {
                attributes: dataPoint.attributes,
                timeUnixNano: dataPoint.timeUnixNano,
                startTimeUnixNano: dataPoint.timeUnixNano,
                count: 1,
                sum: metric.value,
                min: metric.value,
                max: metric.value,
              },
            ],
            aggregationTemporality: 2, // AGGREGATION_TEMPORALITY_CUMULATIVE
          },
        };
      case 'gauge':
        return {
          name: metric.name,
          gauge: {
            dataPoints: [dataPoint],
          },
        };
    }
  }

  private resourceToAttributes(resource: ResourceAttributes): object[] {
    return Object.entries(resource).map(([key, value]) => ({
      key,
      value: { stringValue: value },
    }));
  }

  private toAnyValue(value: string | number | boolean): object {
    if (typeof value === 'string') {
      return { stringValue: value };
    }
    if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        return { intValue: value };
      }
      return { doubleValue: value };
    }
    return { boolValue: value };
  }

  private isoToNano(isoTimestamp: string): string {
    const ms = new Date(isoTimestamp).getTime();
    // Convert milliseconds to nanoseconds as a string (to avoid precision loss)
    return `${BigInt(ms) * BigInt(1_000_000)}`;
  }
}
