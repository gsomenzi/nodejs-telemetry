import { OtlpMetricsExporter } from '../../src/adapters/otlp-metrics-exporter';
import { ResolvedTelemetryConfig } from '../../src/telemetry/config-validator';

// Mock global fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

function createConfig(overrides?: Partial<ResolvedTelemetryConfig>): ResolvedTelemetryConfig {
  return {
    serviceName: 'test-service',
    serviceVersion: '1.0.0',
    environment: 'test',
    logLevel: 'info',
    exporter: {
      endpoint: 'https://otlp.example.com',
      headers: { Authorization: 'Basic dGVzdDp0ZXN0' },
      protocol: 'http',
      timeout: 5000,
      retry: {
        maxAttempts: 3,
        baseInterval: 100,
        maxInterval: 1000,
      },
    },
    ...overrides,
  };
}

describe('OtlpMetricsExporter', () => {
  let exporter: OtlpMetricsExporter;

  beforeEach(() => {
    jest.useFakeTimers();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(async () => {
    if (exporter) {
      await exporter.shutdown();
    }
    jest.useRealTimers();
  });

  describe('MetricsPort interface', () => {
    it('should implement incrementCounter without throwing', () => {
      exporter = new OtlpMetricsExporter(createConfig());
      expect(() => exporter.incrementCounter('test_counter', 1)).not.toThrow();
    });

    it('should implement incrementCounter with default value of 1', () => {
      exporter = new OtlpMetricsExporter(createConfig());
      exporter.incrementCounter('test_counter');
      expect(exporter.getBufferSize()).toBe(1);
    });

    it('should implement recordHistogram without throwing', () => {
      exporter = new OtlpMetricsExporter(createConfig());
      expect(() => exporter.recordHistogram('test_histogram', 42.5)).not.toThrow();
    });

    it('should implement recordGauge without throwing', () => {
      exporter = new OtlpMetricsExporter(createConfig());
      expect(() => exporter.recordGauge('test_gauge', 100)).not.toThrow();
    });

    it('should accept attributes on all metric types', () => {
      exporter = new OtlpMetricsExporter(createConfig());
      const attrs = { region: 'us-east-1', count: 5, active: true };

      exporter.incrementCounter('counter', 1, attrs);
      exporter.recordHistogram('histogram', 10, attrs);
      exporter.recordGauge('gauge', 50, attrs);

      expect(exporter.getBufferSize()).toBe(3);
    });
  });

  describe('buffering', () => {
    it('should buffer metrics internally', () => {
      exporter = new OtlpMetricsExporter(createConfig());

      exporter.incrementCounter('counter_1', 1);
      exporter.recordHistogram('histogram_1', 25);
      exporter.recordGauge('gauge_1', 100);

      expect(exporter.getBufferSize()).toBe(3);
    });

    it('should not accept metrics after shutdown', async () => {
      exporter = new OtlpMetricsExporter(createConfig());
      await exporter.shutdown();

      exporter.incrementCounter('counter_after_shutdown', 1);
      expect(exporter.getBufferSize()).toBe(0);
    });
  });

  describe('flush', () => {
    it('should send buffered metrics to the OTLP endpoint', async () => {
      exporter = new OtlpMetricsExporter(createConfig());

      exporter.incrementCounter('orders_created', 1, { region: 'us-east-1' });
      await exporter.flush();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://otlp.example.com/v1/metrics',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Basic dGVzdDp0ZXN0',
          }),
        }),
      );
    });

    it('should clear the buffer after successful flush', async () => {
      exporter = new OtlpMetricsExporter(createConfig());

      exporter.incrementCounter('counter', 1);
      expect(exporter.getBufferSize()).toBe(1);

      await exporter.flush();
      expect(exporter.getBufferSize()).toBe(0);
    });

    it('should not call fetch when buffer is empty', async () => {
      exporter = new OtlpMetricsExporter(createConfig());
      await exporter.flush();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should serialize metrics in OTLP JSON format', async () => {
      exporter = new OtlpMetricsExporter(createConfig());

      exporter.incrementCounter('test_counter', 5, { env: 'prod' });
      await exporter.flush();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toHaveProperty('resourceMetrics');
      expect(body.resourceMetrics[0].resource.attributes).toEqual(
        expect.arrayContaining([
          { key: 'service.name', value: { stringValue: 'test-service' } },
          { key: 'service.version', value: { stringValue: '1.0.0' } },
          { key: 'deployment.environment', value: { stringValue: 'test' } },
        ]),
      );

      const metrics = body.resourceMetrics[0].scopeMetrics[0].metrics;
      expect(metrics).toHaveLength(1);
      expect(metrics[0].name).toBe('test_counter');
      expect(metrics[0].sum).toBeDefined();
      expect(metrics[0].sum.isMonotonic).toBe(true);
    });

    it('should include auth headers in requests', async () => {
      const config = createConfig({
        exporter: {
          endpoint: 'https://otlp.grafana.net/otlp',
          headers: { Authorization: 'Bearer my-token', 'X-Custom': 'value' },
          protocol: 'http',
          timeout: 5000,
          retry: { maxAttempts: 3, baseInterval: 100, maxInterval: 1000 },
        },
      });
      exporter = new OtlpMetricsExporter(config);

      exporter.incrementCounter('test', 1);
      await exporter.flush();

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBe('Bearer my-token');
      expect(headers['X-Custom']).toBe('value');
      expect(headers['Content-Type']).toBe('application/json');
    });
  });

  describe('endpoint construction', () => {
    it('should append /v1/metrics to the base endpoint', async () => {
      exporter = new OtlpMetricsExporter(createConfig());
      exporter.incrementCounter('test', 1);
      await exporter.flush();

      expect(mockFetch.mock.calls[0][0]).toBe('https://otlp.example.com/v1/metrics');
    });

    it('should handle trailing slash in endpoint', async () => {
      const config = createConfig({
        exporter: {
          endpoint: 'https://otlp.example.com/',
          protocol: 'http',
          timeout: 5000,
          retry: { maxAttempts: 3, baseInterval: 100, maxInterval: 1000 },
        },
      });
      exporter = new OtlpMetricsExporter(config);
      exporter.incrementCounter('test', 1);
      await exporter.flush();

      expect(mockFetch.mock.calls[0][0]).toBe('https://otlp.example.com/v1/metrics');
    });
  });

  describe('retry behavior', () => {
    it('should retry on network errors', async () => {
      const networkError = new Error('Connection refused');
      (networkError as NodeJS.ErrnoException).code = 'ECONNREFUSED';

      mockFetch
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({ ok: true, status: 200 });

      exporter = new OtlpMetricsExporter(createConfig());
      exporter.incrementCounter('test', 1);

      // Start flush (it will retry internally)
      const flushPromise = exporter.flush();

      // Advance timers for retry delays
      await jest.advanceTimersByTimeAsync(100); // first retry delay
      await jest.advanceTimersByTimeAsync(200); // second retry delay

      await flushPromise;

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should not throw when all retries are exhausted', async () => {
      const networkError = new Error('Connection refused');
      (networkError as NodeJS.ErrnoException).code = 'ECONNREFUSED';
      mockFetch.mockRejectedValue(networkError);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      exporter = new OtlpMetricsExporter(createConfig());
      exporter.incrementCounter('test', 1);

      const flushPromise = exporter.flush();

      // Advance timers for all retry delays
      await jest.advanceTimersByTimeAsync(100);
      await jest.advanceTimersByTimeAsync(200);
      await jest.advanceTimersByTimeAsync(400);

      await expect(flushPromise).resolves.toBeUndefined();

      consoleSpy.mockRestore();
    });
  });

  describe('periodic flush', () => {
    it('should flush automatically every 60 seconds', async () => {
      exporter = new OtlpMetricsExporter(createConfig());

      exporter.incrementCounter('periodic_test', 1);

      // Advance timer by 60 seconds
      jest.advanceTimersByTime(60_000);

      // Allow the async flush to complete
      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('shutdown', () => {
    it('should flush remaining metrics on shutdown', async () => {
      exporter = new OtlpMetricsExporter(createConfig());

      exporter.incrementCounter('shutdown_test', 1);
      exporter.recordGauge('active_connections', 42);

      await exporter.shutdown();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const metrics = body.resourceMetrics[0].scopeMetrics[0].metrics;
      expect(metrics).toHaveLength(2);
    });

    it('should stop periodic flush after shutdown', async () => {
      exporter = new OtlpMetricsExporter(createConfig());
      await exporter.shutdown();

      mockFetch.mockClear();

      // Advance timer — should not trigger flush
      jest.advanceTimersByTime(120_000);
      await Promise.resolve();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should never throw on shutdown', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      exporter = new OtlpMetricsExporter(createConfig());
      exporter.incrementCounter('test', 1);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      await expect(exporter.shutdown()).resolves.toBeUndefined();
      consoleSpy.mockRestore();
    });
  });

  describe('resource attributes', () => {
    it('should attach resource attributes from config', async () => {
      const config = createConfig({
        serviceName: 'my-api',
        serviceVersion: '2.3.1',
        environment: 'production',
      });
      exporter = new OtlpMetricsExporter(config);

      exporter.incrementCounter('request_count', 1);
      await exporter.flush();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const resourceAttrs = body.resourceMetrics[0].resource.attributes;

      expect(resourceAttrs).toEqual(
        expect.arrayContaining([
          { key: 'service.name', value: { stringValue: 'my-api' } },
          { key: 'service.version', value: { stringValue: '2.3.1' } },
          { key: 'deployment.environment', value: { stringValue: 'production' } },
        ]),
      );
    });
  });

  describe('OTLP serialization', () => {
    it('should serialize counter metrics with sum type', async () => {
      exporter = new OtlpMetricsExporter(createConfig());
      exporter.incrementCounter('my_counter', 10);
      await exporter.flush();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const metric = body.resourceMetrics[0].scopeMetrics[0].metrics[0];

      expect(metric.name).toBe('my_counter');
      expect(metric.sum).toBeDefined();
      expect(metric.sum.isMonotonic).toBe(true);
      expect(metric.sum.aggregationTemporality).toBe(2);
      expect(metric.sum.dataPoints[0].asDouble).toBe(10);
    });

    it('should serialize histogram metrics', async () => {
      exporter = new OtlpMetricsExporter(createConfig());
      exporter.recordHistogram('request_duration', 150.5);
      await exporter.flush();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const metric = body.resourceMetrics[0].scopeMetrics[0].metrics[0];

      expect(metric.name).toBe('request_duration');
      expect(metric.histogram).toBeDefined();
      expect(metric.histogram.dataPoints[0].sum).toBe(150.5);
      expect(metric.histogram.dataPoints[0].count).toBe(1);
    });

    it('should serialize gauge metrics', async () => {
      exporter = new OtlpMetricsExporter(createConfig());
      exporter.recordGauge('cpu_usage', 75.2);
      await exporter.flush();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const metric = body.resourceMetrics[0].scopeMetrics[0].metrics[0];

      expect(metric.name).toBe('cpu_usage');
      expect(metric.gauge).toBeDefined();
      expect(metric.gauge.dataPoints[0].asDouble).toBe(75.2);
    });

    it('should serialize attributes with correct value types', async () => {
      exporter = new OtlpMetricsExporter(createConfig());
      exporter.incrementCounter('test', 1, {
        strAttr: 'hello',
        intAttr: 42,
        floatAttr: 3.14,
        boolAttr: true,
      });
      await exporter.flush();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const dataPoint = body.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0];
      const attrs = dataPoint.attributes;

      expect(attrs).toEqual(
        expect.arrayContaining([
          { key: 'strAttr', value: { stringValue: 'hello' } },
          { key: 'intAttr', value: { intValue: 42 } },
          { key: 'floatAttr', value: { doubleValue: 3.14 } },
          { key: 'boolAttr', value: { boolValue: true } },
        ]),
      );
    });
  });
});
