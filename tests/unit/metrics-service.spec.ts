import { MetricsService, MetricHandler } from '../../src/telemetry/metrics-service';
import { ResolvedTelemetryConfig } from '../../src/telemetry/config-validator';
import { MetricDataPoint } from '../../src/types';

function createConfig(overrides?: Partial<ResolvedTelemetryConfig>): ResolvedTelemetryConfig {
  return {
    serviceName: 'test-service',
    serviceVersion: '1.0.0',
    environment: 'test',
    logLevel: 'info',
    exporter: {
      endpoint: 'http://localhost:4318',
      protocol: 'http',
      timeout: 30000,
      retry: { maxAttempts: 3, baseInterval: 1000, maxInterval: 60000 },
    },
    ...overrides,
  };
}

describe('MetricsService', () => {
  describe('incrementCounter', () => {
    it('should create a counter metric data point with default value 1', () => {
      const service = new MetricsService(createConfig());

      service.incrementCounter('requests_total');

      const buffer = service.getMetricBuffer();
      expect(buffer).toHaveLength(1);
      expect(buffer[0].name).toBe('requests_total');
      expect(buffer[0].type).toBe('counter');
      expect(buffer[0].value).toBe(1);
    });

    it('should create a counter metric data point with specified value', () => {
      const service = new MetricsService(createConfig());

      service.incrementCounter('orders_created', 5);

      const buffer = service.getMetricBuffer();
      expect(buffer).toHaveLength(1);
      expect(buffer[0].value).toBe(5);
    });

    it('should include attributes when provided', () => {
      const service = new MetricsService(createConfig());

      service.incrementCounter('requests_total', 1, { region: 'us-east-1', status: 200 });

      const buffer = service.getMetricBuffer();
      expect(buffer[0].attributes).toEqual({ region: 'us-east-1', status: 200 });
    });
  });

  describe('recordHistogram', () => {
    it('should create a histogram metric data point', () => {
      const service = new MetricsService(createConfig());

      service.recordHistogram('response_time_ms', 150.5);

      const buffer = service.getMetricBuffer();
      expect(buffer).toHaveLength(1);
      expect(buffer[0].name).toBe('response_time_ms');
      expect(buffer[0].type).toBe('histogram');
      expect(buffer[0].value).toBe(150.5);
    });

    it('should include attributes when provided', () => {
      const service = new MetricsService(createConfig());

      service.recordHistogram('response_time_ms', 200, { endpoint: '/api/orders' });

      const buffer = service.getMetricBuffer();
      expect(buffer[0].attributes).toEqual({ endpoint: '/api/orders' });
    });
  });

  describe('recordGauge', () => {
    it('should create a gauge metric data point', () => {
      const service = new MetricsService(createConfig());

      service.recordGauge('active_connections', 42);

      const buffer = service.getMetricBuffer();
      expect(buffer).toHaveLength(1);
      expect(buffer[0].name).toBe('active_connections');
      expect(buffer[0].type).toBe('gauge');
      expect(buffer[0].value).toBe(42);
    });

    it('should include attributes when provided', () => {
      const service = new MetricsService(createConfig());

      service.recordGauge('cpu_usage', 0.75, { host: 'server-1' });

      const buffer = service.getMetricBuffer();
      expect(buffer[0].attributes).toEqual({ host: 'server-1' });
    });
  });

  describe('resource attributes', () => {
    it('should attach resource attributes to all metrics', () => {
      const config = createConfig({
        serviceName: 'order-service',
        serviceVersion: '2.3.1',
        environment: 'production',
      });
      const service = new MetricsService(config);

      service.incrementCounter('test_counter');
      service.recordHistogram('test_histogram', 100);
      service.recordGauge('test_gauge', 50);

      const buffer = service.getMetricBuffer();
      for (const metric of buffer) {
        expect(metric.resource).toEqual({
          'service.name': 'order-service',
          'service.version': '2.3.1',
          'deployment.environment': 'production',
        });
      }
    });
  });

  describe('timestamp', () => {
    it('should record an ISO 8601 timestamp for each metric', () => {
      const service = new MetricsService(createConfig());

      service.incrementCounter('test_metric');

      const buffer = service.getMetricBuffer();
      expect(buffer[0].timestamp).toBeDefined();
      expect(new Date(buffer[0].timestamp).toISOString()).toBe(buffer[0].timestamp);
    });
  });

  describe('buffering', () => {
    it('should buffer multiple metric data points', () => {
      const service = new MetricsService(createConfig());

      service.incrementCounter('counter_1');
      service.recordHistogram('histogram_1', 100);
      service.recordGauge('gauge_1', 50);

      expect(service.getMetricBuffer()).toHaveLength(3);
    });

    it('should clear the buffer when clearMetricBuffer is called', () => {
      const service = new MetricsService(createConfig());

      service.incrementCounter('counter_1');
      service.incrementCounter('counter_2');
      expect(service.getMetricBuffer()).toHaveLength(2);

      service.clearMetricBuffer();
      expect(service.getMetricBuffer()).toHaveLength(0);
    });
  });

  describe('metric handler callback', () => {
    it('should pass metrics to handler when provided', () => {
      const handler: MetricHandler = jest.fn();
      const service = new MetricsService(createConfig(), handler);

      service.incrementCounter('handled_metric', 1, { key: 'value' });

      expect(handler).toHaveBeenCalledTimes(1);
      const metric = (handler as jest.Mock).mock.calls[0][0] as MetricDataPoint;
      expect(metric.name).toBe('handled_metric');
      expect(metric.type).toBe('counter');
      expect(metric.value).toBe(1);
      expect(service.getMetricBuffer()).toHaveLength(0);
    });
  });

  describe('fail-safe behavior', () => {
    it('should never throw even if metric handler throws', () => {
      const handler: MetricHandler = () => {
        throw new Error('Handler explosion');
      };
      const service = new MetricsService(createConfig(), handler);

      expect(() => service.incrementCounter('test')).not.toThrow();
      expect(() => service.recordHistogram('test', 100)).not.toThrow();
      expect(() => service.recordGauge('test', 50)).not.toThrow();
    });

    it('should never throw with unexpected input', () => {
      const service = new MetricsService(createConfig());

      expect(() => service.incrementCounter('')).not.toThrow();
      expect(() => service.recordHistogram('', NaN)).not.toThrow();
      expect(() => service.recordGauge('', Infinity)).not.toThrow();
    });
  });
});
