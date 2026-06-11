import {
  createLoggerAdapter,
  isShutdownableLogger,
} from '../../src/telemetry/logger-adapter.factory';
import { ResolvedTelemetryConfig } from '../../src/telemetry/config-validator';
import { OtlpLogExporter } from '../../src/adapters/otlp-log-exporter';
import { ConsoleLogAdapter } from '../../src/adapters/console-log-adapter';
import { NoopLoggerAdapter } from '../../src/adapters/noop-logger-adapter';
import { LoggerPort } from '../../src/ports/logger.port';

function createConfig(): ResolvedTelemetryConfig {
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
  };
}

describe('createLoggerAdapter', () => {
  const config = createConfig();

  it('should create OtlpLogExporter by default', () => {
    const logger = createLoggerAdapter(config);
    expect(logger).toBeInstanceOf(OtlpLogExporter);
  });

  it('should create OtlpLogExporter when adapter is "otlp"', () => {
    const logger = createLoggerAdapter(config, 'otlp');
    expect(logger).toBeInstanceOf(OtlpLogExporter);
  });

  it('should create ConsoleLogAdapter when adapter is "console"', () => {
    const logger = createLoggerAdapter(config, 'console');
    expect(logger).toBeInstanceOf(ConsoleLogAdapter);
  });

  it('should create NoopLoggerAdapter when adapter is "noop"', () => {
    const logger = createLoggerAdapter(config, 'noop');
    expect(logger).toBeInstanceOf(NoopLoggerAdapter);
  });

  it('should use custom logger when provided', () => {
    const customLogger: LoggerPort = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      fatal: jest.fn(),
    };

    const logger = createLoggerAdapter(config, { adapter: 'console', logger: customLogger });
    expect(logger).toBe(customLogger);
  });

  it('should accept options object with adapter field', () => {
    const logger = createLoggerAdapter(config, { adapter: 'noop' });
    expect(logger).toBeInstanceOf(NoopLoggerAdapter);
  });
});

describe('isShutdownableLogger', () => {
  it('should return true for OtlpLogExporter', () => {
    const logger = createLoggerAdapter(createConfig(), 'otlp');
    expect(isShutdownableLogger(logger)).toBe(true);
  });

  it('should return false for ConsoleLogAdapter', () => {
    const logger = createLoggerAdapter(createConfig(), 'console');
    expect(isShutdownableLogger(logger)).toBe(false);
  });

  it('should return false for NoopLoggerAdapter', () => {
    const logger = createLoggerAdapter(createConfig(), 'noop');
    expect(isShutdownableLogger(logger)).toBe(false);
  });
});
