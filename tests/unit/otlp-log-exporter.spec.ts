import { OtlpLogExporter } from '../../src/adapters/otlp-log-exporter';
import { ResolvedTelemetryConfig } from '../../src/telemetry/config-validator';
import { contextManager } from '../../src/telemetry/context-manager';

// Mock fetch globally
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('OtlpLogExporter', () => {
  let exporter: OtlpLogExporter;
  let config: ResolvedTelemetryConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    config = {
      serviceName: 'test-service',
      serviceVersion: '1.0.0',
      environment: 'test',
      logLevel: 'debug',
      exporter: {
        endpoint: 'https://otlp.example.com/otlp',
        headers: { Authorization: 'Basic dGVzdDp0ZXN0' },
        protocol: 'http' as const,
        timeout: 5000,
        retry: {
          maxAttempts: 3,
          baseInterval: 100,
          maxInterval: 1000,
        },
      },
    };

    // Disable periodic flush for tests (use large interval)
    exporter = new OtlpLogExporter(config, { flushIntervalMs: 60000 });
  });

  afterEach(async () => {
    await exporter.shutdown();
    contextManager.clear();
  });

  describe('LoggerPort interface', () => {
    it('should implement debug method', () => {
      exporter.debug('debug message');
      expect(exporter.getBufferSize()).toBe(1);
    });

    it('should implement info method', () => {
      exporter.info('info message');
      expect(exporter.getBufferSize()).toBe(1);
    });

    it('should implement warn method', () => {
      exporter.warn('warn message');
      expect(exporter.getBufferSize()).toBe(1);
    });

    it('should implement error method', () => {
      exporter.error('error message');
      expect(exporter.getBufferSize()).toBe(1);
    });

    it('should implement fatal method', () => {
      exporter.fatal('fatal message');
      expect(exporter.getBufferSize()).toBe(1);
    });

    it('should accept optional context parameter', () => {
      exporter.info('message', { key: 'value', count: 42 });
      expect(exporter.getBufferSize()).toBe(1);
    });
  });

  describe('log level filtering', () => {
    it('should discard logs below configured minimum level', () => {
      const warnExporter = new OtlpLogExporter(
        { ...config, logLevel: 'warn' },
        { flushIntervalMs: 60000 },
      );

      warnExporter.debug('should be discarded');
      warnExporter.info('should be discarded');
      warnExporter.warn('should be kept');
      warnExporter.error('should be kept');
      warnExporter.fatal('should be kept');

      expect(warnExporter.getBufferSize()).toBe(3);
      void warnExporter.shutdown();
    });
  });

  describe('flush and export', () => {
    it('should send buffered logs to OTLP endpoint on flush', async () => {
      exporter.info('test message', { orderId: '123' });
      await exporter.flush();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://otlp.example.com/otlp/v1/logs');
      expect(options.method).toBe('POST');
    });

    it('should include authentication headers in requests', async () => {
      exporter.info('test message');
      await exporter.flush();

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers).toMatchObject({
        'Content-Type': 'application/json',
        Authorization: 'Basic dGVzdDp0ZXN0',
      });
    });

    it('should build valid OTLP JSON payload', async () => {
      exporter.info('order created', { orderId: 'abc-123' });
      await exporter.flush();

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);

      expect(payload.resourceLogs).toHaveLength(1);
      expect(payload.resourceLogs[0].resource.attributes).toEqual(
        expect.arrayContaining([
          { key: 'service.name', value: { stringValue: 'test-service' } },
          { key: 'service.version', value: { stringValue: '1.0.0' } },
          { key: 'deployment.environment', value: { stringValue: 'test' } },
        ]),
      );

      const logRecord = payload.resourceLogs[0].scopeLogs[0].logRecords[0];
      expect(logRecord.severityNumber).toBe(9); // INFO
      expect(logRecord.severityText).toBe('INFO');
      expect(logRecord.body).toEqual({ stringValue: 'order created' });
      expect(logRecord.attributes).toEqual(
        expect.arrayContaining([
          { key: 'orderId', value: { stringValue: 'abc-123' } },
        ]),
      );
    });

    it('should not call fetch when buffer is empty', async () => {
      await exporter.flush();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should clear buffer after successful flush', async () => {
      exporter.info('message 1');
      exporter.info('message 2');
      expect(exporter.getBufferSize()).toBe(2);

      await exporter.flush();
      expect(exporter.getBufferSize()).toBe(0);
    });

    it('should append /v1/logs to endpoint if not present', async () => {
      exporter.info('test');
      await exporter.flush();

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://otlp.example.com/otlp/v1/logs');
    });

    it('should not duplicate /v1/logs if already in endpoint', async () => {
      const customConfig = {
        ...config,
        exporter: { ...config.exporter, endpoint: 'https://otlp.example.com/v1/logs' },
      };
      const customExporter = new OtlpLogExporter(customConfig, { flushIntervalMs: 60000 });

      customExporter.info('test');
      await customExporter.flush();

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://otlp.example.com/v1/logs');
      await customExporter.shutdown();
    });
  });

  describe('correlation context enrichment', () => {
    it('should include traceId and spanId when correlation context is active', async () => {
      // Simulate an active span by setting correlation context
      const mockSpan = {
        traceId: 'abc123trace',
        spanId: 'def456span',
        name: 'test-span',
        setAttribute: jest.fn(),
        addEvent: jest.fn(),
        recordError: jest.fn(),
        setStatus: jest.fn(),
        end: jest.fn(),
      };

      contextManager.setActiveSpan(mockSpan as any);

      exporter.info('correlated message');
      await exporter.flush();

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      const logRecord = payload.resourceLogs[0].scopeLogs[0].logRecords[0];

      expect(logRecord.traceId).toBe('abc123trace');
      expect(logRecord.spanId).toBe('def456span');

      contextManager.clear();
    });

    it('should not include traceId/spanId when no correlation context', async () => {
      exporter.info('uncorrelated message');
      await exporter.flush();

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      const logRecord = payload.resourceLogs[0].scopeLogs[0].logRecords[0];

      expect(logRecord.traceId).toBeUndefined();
      expect(logRecord.spanId).toBeUndefined();
    });
  });

  describe('retry logic', () => {
    it('should retry on 5xx server errors', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      exporter.info('retry test');
      await exporter.flush();

      // executeWithRetry handles the retry internally
      // The first call fails with a retryable error code, second succeeds
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should discard data and console.error after all retries exhausted', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });

      exporter.info('will be discarded');
      await exporter.flush();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('fail-safe behavior', () => {
    it('should never throw from log methods', () => {
      // Even if internal state is corrupted, methods should not throw
      expect(() => exporter.debug('test')).not.toThrow();
      expect(() => exporter.info('test')).not.toThrow();
      expect(() => exporter.warn('test')).not.toThrow();
      expect(() => exporter.error('test')).not.toThrow();
      expect(() => exporter.fatal('test')).not.toThrow();
    });

    it('should not throw on shutdown even if flush fails', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));
      exporter.info('pending log');
      await expect(exporter.shutdown()).resolves.not.toThrow();
    });
  });

  describe('batching', () => {
    it('should auto-flush when maxBatchSize is reached', async () => {
      const smallBatchExporter = new OtlpLogExporter(config, {
        flushIntervalMs: 60000,
        maxBatchSize: 3,
      });

      smallBatchExporter.info('msg 1');
      smallBatchExporter.info('msg 2');
      smallBatchExporter.info('msg 3'); // Should trigger flush

      // Give the async flush a tick to execute
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      await smallBatchExporter.shutdown();
    });
  });
});
