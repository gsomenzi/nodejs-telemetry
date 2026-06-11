import { TelemetryFactory, TelemetryInstance } from '../../src/telemetry/telemetry-factory';
import { InvalidConfigurationError } from '../../src/errors';
import { TelemetryConfig } from '../../src/types';
import { ConsoleLogAdapter } from '../../src/adapters/console-log-adapter';
import { NoopLoggerAdapter } from '../../src/adapters/noop-logger-adapter';
import { OtlpLogExporter } from '../../src/adapters/otlp-log-exporter';

describe('TelemetryFactory', () => {
  const validConfig: TelemetryConfig = {
    serviceName: 'test-service',
    environment: 'production',
    exporter: {
      endpoint: 'https://otlp.example.com/v1',
      headers: { Authorization: 'Basic abc123' },
    },
  };

  afterEach(async () => {
    // Ensure shutdown is called after each test to clean up exporters
    await TelemetryFactory.shutdown();
  });

  describe('create', () => {
    it('should return a TelemetryInstance with logger, tracer, and metrics', () => {
      const instance = TelemetryFactory.create(validConfig);

      expect(instance).toBeDefined();
      expect(instance.logger).toBeDefined();
      expect(instance.tracer).toBeDefined();
      expect(instance.metrics).toBeDefined();
    });

    it('should return a logger with all LoggerPort methods', () => {
      const instance = TelemetryFactory.create(validConfig);

      expect(typeof instance.logger.debug).toBe('function');
      expect(typeof instance.logger.info).toBe('function');
      expect(typeof instance.logger.warn).toBe('function');
      expect(typeof instance.logger.error).toBe('function');
      expect(typeof instance.logger.fatal).toBe('function');
    });

    it('should return a tracer with all TracerPort methods', () => {
      const instance = TelemetryFactory.create(validConfig);

      expect(typeof instance.tracer.startSpan).toBe('function');
      expect(typeof instance.tracer.getActiveSpan).toBe('function');
    });

    it('should return metrics with all MetricsPort methods', () => {
      const instance = TelemetryFactory.create(validConfig);

      expect(typeof instance.metrics.incrementCounter).toBe('function');
      expect(typeof instance.metrics.recordHistogram).toBe('function');
      expect(typeof instance.metrics.recordGauge).toBe('function');
    });

    it('should throw InvalidConfigurationError when serviceName is missing', () => {
      const badConfig: TelemetryConfig = {
        ...validConfig,
        serviceName: '',
      };

      expect(() => TelemetryFactory.create(badConfig)).toThrow(InvalidConfigurationError);
    });

    it('should throw InvalidConfigurationError when environment is missing', () => {
      const badConfig: TelemetryConfig = {
        ...validConfig,
        environment: '',
      };

      expect(() => TelemetryFactory.create(badConfig)).toThrow(InvalidConfigurationError);
    });

    it('should throw InvalidConfigurationError when exporter.endpoint is missing', () => {
      const badConfig: TelemetryConfig = {
        ...validConfig,
        exporter: { endpoint: '' },
      };

      expect(() => TelemetryFactory.create(badConfig)).toThrow(InvalidConfigurationError);
    });

    it('should allow creating multiple instances', () => {
      const instance1 = TelemetryFactory.create(validConfig);
      const instance2 = TelemetryFactory.create({
        ...validConfig,
        serviceName: 'another-service',
      });

      expect(instance1).toBeDefined();
      expect(instance2).toBeDefined();
      expect(instance1).not.toBe(instance2);
    });

    it('should use ConsoleLogAdapter when loggerAdapter is "console"', () => {
      const instance = TelemetryFactory.create({
        ...validConfig,
        loggerAdapter: 'console',
      });

      expect(instance.logger).toBeInstanceOf(ConsoleLogAdapter);
    });

    it('should use NoopLoggerAdapter when loggerAdapter is "noop"', () => {
      const instance = TelemetryFactory.create({
        ...validConfig,
        loggerAdapter: 'noop',
      });

      expect(instance.logger).toBeInstanceOf(NoopLoggerAdapter);
    });

    it('should use OtlpLogExporter by default', () => {
      const instance = TelemetryFactory.create(validConfig);
      expect(instance.logger).toBeInstanceOf(OtlpLogExporter);
    });

    it('should use custom logger when provided in options', () => {
      const customLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        fatal: jest.fn(),
      };

      const instance = TelemetryFactory.create(validConfig, { logger: customLogger });
      expect(instance.logger).toBe(customLogger);
    });
  });

  describe('shutdown', () => {
    it('should not throw when no instances have been created', async () => {
      await expect(TelemetryFactory.shutdown()).resolves.toBeUndefined();
    });

    it('should not throw after creating instances', async () => {
      TelemetryFactory.create(validConfig);

      await expect(TelemetryFactory.shutdown()).resolves.toBeUndefined();
    });

    it('should not throw when called multiple times', async () => {
      TelemetryFactory.create(validConfig);

      await expect(TelemetryFactory.shutdown()).resolves.toBeUndefined();
      await expect(TelemetryFactory.shutdown()).resolves.toBeUndefined();
    });

    it('should clear internal exporter references after shutdown', async () => {
      TelemetryFactory.create(validConfig);
      await TelemetryFactory.shutdown();

      // Second shutdown should be a no-op (no exporters to flush)
      await expect(TelemetryFactory.shutdown()).resolves.toBeUndefined();
    });
  });
});
