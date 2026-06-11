import { ConsoleLogAdapter } from '../../src/adapters/console-log-adapter';
import { ResolvedTelemetryConfig } from '../../src/telemetry/config-validator';
import { contextManager } from '../../src/telemetry/context-manager';
import { SpanPort } from '../../src/ports/tracer.port';

function createConfig(overrides?: Partial<ResolvedTelemetryConfig>): ResolvedTelemetryConfig {
  return {
    serviceName: 'test-service',
    serviceVersion: '1.0.0',
    environment: 'test',
    logLevel: 'debug',
    exporter: {
      endpoint: 'http://localhost:4318',
      protocol: 'http',
      timeout: 30000,
      retry: { maxAttempts: 3, baseInterval: 1000, maxInterval: 60000 },
    },
    ...overrides,
  };
}

describe('ConsoleLogAdapter', () => {
  let adapter: ConsoleLogAdapter;
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    adapter = new ConsoleLogAdapter(createConfig());
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    contextManager.clear();
  });

  it('should output structured JSON with timestamp, level, message, and resource', () => {
    adapter.info('Hello world');

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const output = (stdoutSpy.mock.calls[0][0] as string).trim();
    const parsed = JSON.parse(output);

    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('Hello world');
    expect(parsed.timestamp).toBeDefined();
    expect(new Date(parsed.timestamp).toISOString()).toBe(parsed.timestamp);
    expect(parsed.resource).toEqual({
      'service.name': 'test-service',
      'service.version': '1.0.0',
      'deployment.environment': 'test',
    });
  });

  it('should include context when provided', () => {
    adapter.info('Order created', { orderId: '123', amount: 99.9 });

    const output = (stdoutSpy.mock.calls[0][0] as string).trim();
    const parsed = JSON.parse(output);

    expect(parsed.context).toEqual({ orderId: '123', amount: 99.9 });
  });

  it('should not include context key when context is undefined', () => {
    adapter.info('Simple message');

    const output = (stdoutSpy.mock.calls[0][0] as string).trim();
    const parsed = JSON.parse(output);

    expect(parsed).not.toHaveProperty('context');
  });

  it('should include correlation when active span exists', () => {
    const mockSpan: SpanPort = {
      traceId: 'trace-abc',
      spanId: 'span-def',
      name: 'test-span',
      setAttribute: jest.fn(),
      addEvent: jest.fn(),
      recordError: jest.fn(),
      setStatus: jest.fn(),
      end: jest.fn(),
    };
    contextManager.setActiveSpan(mockSpan);

    adapter.info('Correlated log');

    const output = (stdoutSpy.mock.calls[0][0] as string).trim();
    const parsed = JSON.parse(output);

    expect(parsed.correlation).toEqual({
      traceId: 'trace-abc',
      spanId: 'span-def',
    });
  });

  it('should filter logs below configured minimum level', () => {
    adapter = new ConsoleLogAdapter(createConfig({ logLevel: 'warn' }));

    adapter.debug('debug');
    adapter.info('info');
    adapter.warn('warn');

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const output = (stdoutSpy.mock.calls[0][0] as string).trim();
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe('warn');
  });

  it.each(['debug', 'info', 'warn', 'error', 'fatal'] as const)(
    'should output correct level for %s',
    (level) => {
      adapter[level]('test message');

      const output = (stdoutSpy.mock.calls[0][0] as string).trim();
      const parsed = JSON.parse(output);

      expect(parsed.level).toBe(level);
    },
  );

  it('should append newline to each log entry', () => {
    adapter.info('test');

    const output = stdoutSpy.mock.calls[0][0] as string;
    expect(output.endsWith('\n')).toBe(true);
  });

  it('should never throw even if stdout.write fails', () => {
    stdoutSpy.mockImplementation(() => {
      throw new Error('stdout broken');
    });

    expect(() => adapter.info('should not throw')).not.toThrow();
    expect(() => adapter.error('should not throw')).not.toThrow();
  });

  it('should handle context with circular references gracefully', () => {
    const circular: Record<string, unknown> = { key: 'value' };
    circular.self = circular;

    expect(() => adapter.info('circular', circular)).not.toThrow();
  });
});
