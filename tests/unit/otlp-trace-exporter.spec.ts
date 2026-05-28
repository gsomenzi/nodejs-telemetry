import { OtlpTraceExporter } from '../../src/adapters/otlp-trace-exporter';
import { ResolvedTelemetryConfig } from '../../src/telemetry/config-validator';
import { contextManager } from '../../src/telemetry/context-manager';

function createConfig(overrides?: Partial<ResolvedTelemetryConfig>): ResolvedTelemetryConfig {
  return {
    serviceName: 'test-service',
    serviceVersion: '1.0.0',
    environment: 'test',
    logLevel: 'info',
    exporter: {
      endpoint: 'http://localhost:4318',
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

describe('OtlpTraceExporter', () => {
  let exporter: OtlpTraceExporter;

  beforeEach(() => {
    contextManager.clear();
  });

  afterEach(async () => {
    if (exporter) {
      await exporter.shutdown();
    }
  });

  describe('startSpan', () => {
    it('should create a span with a unique spanId and traceId', () => {
      exporter = new OtlpTraceExporter(createConfig());

      contextManager.run(() => {
        const span = exporter.startSpan('test-span');

        expect(span.spanId).toBeDefined();
        expect(span.traceId).toBeDefined();
        expect(span.name).toBe('test-span');
      });
    });

    it('should inherit traceId from active parent span', () => {
      exporter = new OtlpTraceExporter(createConfig());

      contextManager.run(() => {
        const parent = exporter.startSpan('parent');
        const child = exporter.startSpan('child');

        expect(child.traceId).toBe(parent.traceId);
        expect(child.spanId).not.toBe(parent.spanId);

        child.end();
        parent.end();
      });
    });

    it('should inherit traceId from explicit parentSpan option', () => {
      exporter = new OtlpTraceExporter(createConfig());

      contextManager.run(() => {
        const parent = exporter.startSpan('parent');
        parent.end();

        const child = exporter.startSpan('child', { parentSpan: parent });
        expect(child.traceId).toBe(parent.traceId);
        child.end();
      });
    });

    it('should apply initial attributes', () => {
      exporter = new OtlpTraceExporter(createConfig());

      contextManager.run(() => {
        const span = exporter.startSpan('test-span', {
          attributes: { 'http.method': 'GET', 'http.status_code': 200 },
        });

        expect(span).toBeDefined();
        span.end();
      });
    });

    it('should set the span as active in context', () => {
      exporter = new OtlpTraceExporter(createConfig());

      contextManager.run(() => {
        const span = exporter.startSpan('test-span');
        const active = exporter.getActiveSpan();

        expect(active).toBe(span);
        span.end();
      });
    });

    it('should never throw and return NoopSpan on error', () => {
      exporter = new OtlpTraceExporter(createConfig());

      // Even without a context store, startSpan should not throw
      const span = exporter.startSpan('test-span');
      expect(span).toBeDefined();
      expect(() => span.end()).not.toThrow();
    });
  });

  describe('getActiveSpan', () => {
    it('should return null when no span is active', () => {
      exporter = new OtlpTraceExporter(createConfig());

      contextManager.run(() => {
        expect(exporter.getActiveSpan()).toBeNull();
      });
    });

    it('should return the active span after startSpan', () => {
      exporter = new OtlpTraceExporter(createConfig());

      contextManager.run(() => {
        const span = exporter.startSpan('test-span');
        expect(exporter.getActiveSpan()).toBe(span);
        span.end();
      });
    });

    it('should restore parent span after child ends', () => {
      exporter = new OtlpTraceExporter(createConfig());

      contextManager.run(() => {
        const parent = exporter.startSpan('parent');
        const child = exporter.startSpan('child');

        expect(exporter.getActiveSpan()).toBe(child);

        child.end();
        expect(exporter.getActiveSpan()).toBe(parent);

        parent.end();
        expect(exporter.getActiveSpan()).toBeNull();
      });
    });
  });

  describe('span export on end', () => {
    it('should buffer span data when span ends', () => {
      exporter = new OtlpTraceExporter(createConfig());

      contextManager.run(() => {
        const span = exporter.startSpan('test-span');
        span.setAttribute('key', 'value');
        span.end();

        const buffer = exporter.getSpanBuffer();
        expect(buffer).toHaveLength(1);
        expect(buffer[0].name).toBe('test-span');
        expect(buffer[0].attributes).toEqual({ key: 'value' });
        expect(buffer[0].status).toBe('UNSET');
        expect(buffer[0].startTime).toBeDefined();
        expect(buffer[0].endTime).toBeDefined();
      });
    });

    it('should include resource attributes in buffered span data', () => {
      exporter = new OtlpTraceExporter(createConfig());

      contextManager.run(() => {
        const span = exporter.startSpan('test-span');
        span.end();

        const buffer = exporter.getSpanBuffer();
        expect(buffer[0].resource).toEqual({
          'service.name': 'test-service',
          'service.version': '1.0.0',
          'deployment.environment': 'test',
        });
      });
    });

    it('should include parentSpanId for child spans', () => {
      exporter = new OtlpTraceExporter(createConfig());

      contextManager.run(() => {
        const parent = exporter.startSpan('parent');
        const child = exporter.startSpan('child');
        child.end();
        parent.end();

        const buffer = exporter.getSpanBuffer();
        const childData = buffer.find((s) => s.name === 'child');
        const parentData = buffer.find((s) => s.name === 'parent');

        expect(childData?.parentSpanId).toBe(parent.spanId);
        expect(parentData?.parentSpanId).toBeUndefined();
      });
    });

    it('should include events in buffered span data', () => {
      exporter = new OtlpTraceExporter(createConfig());

      contextManager.run(() => {
        const span = exporter.startSpan('test-span');
        span.addEvent('event-1', { detail: 'info' });
        span.end();

        const buffer = exporter.getSpanBuffer();
        expect(buffer[0].events).toHaveLength(1);
        expect(buffer[0].events[0].name).toBe('event-1');
      });
    });

    it('should record error status in buffered span data', () => {
      exporter = new OtlpTraceExporter(createConfig());

      contextManager.run(() => {
        const span = exporter.startSpan('test-span');
        span.recordError(new Error('something failed'));
        span.end();

        const buffer = exporter.getSpanBuffer();
        expect(buffer[0].status).toBe('ERROR');
        expect(buffer[0].events).toHaveLength(1);
        expect(buffer[0].events[0].name).toBe('exception');
      });
    });

    it('should not buffer span data after shutdown', async () => {
      exporter = new OtlpTraceExporter(createConfig());
      await exporter.shutdown();

      contextManager.run(() => {
        const span = exporter.startSpan('test-span');
        span.end();

        expect(exporter.getSpanBuffer()).toHaveLength(0);
      });
    });
  });

  describe('flush', () => {
    it('should clear the buffer after flush', async () => {
      exporter = new OtlpTraceExporter(createConfig());

      // Mock fetch to succeed
      const mockFetch = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      contextManager.run(() => {
        const span = exporter.startSpan('test-span');
        span.end();
      });

      expect(exporter.getSpanBuffer()).toHaveLength(1);

      await exporter.flush();

      expect(exporter.getSpanBuffer()).toHaveLength(0);
    });

    it('should send spans to the correct OTLP endpoint', async () => {
      exporter = new OtlpTraceExporter(createConfig());

      const mockFetch = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      contextManager.run(() => {
        const span = exporter.startSpan('test-span');
        span.end();
      });

      await exporter.flush();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4318/v1/traces',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Basic dGVzdDp0ZXN0',
          }),
        }),
      );
    });

    it('should include auth headers in export requests', async () => {
      const config = createConfig({
        exporter: {
          endpoint: 'https://otlp.grafana.net/otlp',
          headers: { Authorization: 'Bearer my-token', 'X-Custom': 'header' },
          protocol: 'http',
          timeout: 5000,
          retry: { maxAttempts: 3, baseInterval: 100, maxInterval: 1000 },
        },
      });
      exporter = new OtlpTraceExporter(config);

      const mockFetch = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      contextManager.run(() => {
        const span = exporter.startSpan('test-span');
        span.end();
      });

      await exporter.flush();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://otlp.grafana.net/otlp/v1/traces',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-token',
            'X-Custom': 'header',
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('should not call fetch when buffer is empty', async () => {
      exporter = new OtlpTraceExporter(createConfig());

      const mockFetch = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      await exporter.flush();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should serialize span data in OTLP JSON format', async () => {
      exporter = new OtlpTraceExporter(createConfig());

      const mockFetch = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      contextManager.run(() => {
        const span = exporter.startSpan('test-span');
        span.setAttribute('http.method', 'GET');
        span.setAttribute('http.status_code', 200);
        span.setAttribute('success', true);
        span.end();
      });

      await exporter.flush();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.resourceSpans).toHaveLength(1);
      expect(body.resourceSpans[0].resource.attributes).toEqual(
        expect.arrayContaining([
          { key: 'service.name', value: { stringValue: 'test-service' } },
        ]),
      );

      const spans = body.resourceSpans[0].scopeSpans[0].spans;
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe('test-span');
      expect(spans[0].attributes).toEqual(
        expect.arrayContaining([
          { key: 'http.method', value: { stringValue: 'GET' } },
          { key: 'http.status_code', value: { intValue: 200 } },
          { key: 'success', value: { boolValue: true } },
        ]),
      );
    });
  });

  describe('shutdown', () => {
    it('should flush remaining spans on shutdown', async () => {
      exporter = new OtlpTraceExporter(createConfig());

      const mockFetch = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      contextManager.run(() => {
        const span = exporter.startSpan('test-span');
        span.end();
      });

      await exporter.shutdown();

      expect(mockFetch).toHaveBeenCalled();
      expect(exporter.getSpanBuffer()).toHaveLength(0);
    });

    it('should not throw on shutdown errors', async () => {
      exporter = new OtlpTraceExporter(createConfig());

      const mockFetch = jest.fn().mockRejectedValue(new Error('network error'));
      global.fetch = mockFetch;

      contextManager.run(() => {
        const span = exporter.startSpan('test-span');
        span.end();
      });

      await expect(exporter.shutdown()).resolves.not.toThrow();
    });
  });

  describe('retry behavior', () => {
    it('should retry on network errors', async () => {
      exporter = new OtlpTraceExporter(createConfig());

      const networkError = new Error('connection refused');
      (networkError as NodeJS.ErrnoException).code = 'ECONNREFUSED';

      const mockFetch = jest
        .fn()
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({ ok: true });
      global.fetch = mockFetch;

      contextManager.run(() => {
        const span = exporter.startSpan('test-span');
        span.end();
      });

      await exporter.flush();

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should discard data after max retries exhausted', async () => {
      exporter = new OtlpTraceExporter(createConfig());

      const networkError = new Error('connection refused');
      (networkError as NodeJS.ErrnoException).code = 'ECONNREFUSED';

      const mockFetch = jest.fn().mockRejectedValue(networkError);
      global.fetch = mockFetch;

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      contextManager.run(() => {
        const span = exporter.startSpan('test-span');
        span.end();
      });

      await exporter.flush();

      // maxAttempts is 3, so fetch is called 3 times
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
