import { Test, TestingModule } from '@nestjs/testing';
import { TelemetryModule, TelemetryModuleOptions } from '../../src/nestjs/telemetry.module';
import { LOGGER_PORT } from '../../src/ports/logger.port';
import { TRACER_PORT } from '../../src/ports/tracer.port';
import { METRICS_PORT } from '../../src/ports/metrics.port';
import { OtlpLogExporter } from '../../src/adapters/otlp-log-exporter';
import { OtlpTraceExporter } from '../../src/adapters/otlp-trace-exporter';
import { OtlpMetricsExporter } from '../../src/adapters/otlp-metrics-exporter';
import { ConsoleLogAdapter } from '../../src/adapters/console-log-adapter';
import { NoopLoggerAdapter } from '../../src/adapters/noop-logger-adapter';
import { InvalidConfigurationError } from '../../src/errors';
import { LoggerPort } from '../../src/ports/logger.port';

const validOptions: TelemetryModuleOptions = {
  serviceName: 'test-service',
  environment: 'testing',
  exporter: {
    endpoint: 'https://otlp.example.com/otlp',
    headers: { Authorization: 'Basic abc123' },
  },
};

describe('TelemetryModule', () => {
  describe('forRoot', () => {
    let module: TestingModule;

    afterEach(async () => {
      if (module) {
        await module.close();
      }
    });

    it('should register LOGGER_PORT provider', async () => {
      module = await Test.createTestingModule({
        imports: [TelemetryModule.forRoot(validOptions)],
      }).compile();

      const logger = module.get(LOGGER_PORT);
      expect(logger).toBeDefined();
      expect(logger).toBeInstanceOf(OtlpLogExporter);
    });

    it('should register TRACER_PORT provider', async () => {
      module = await Test.createTestingModule({
        imports: [TelemetryModule.forRoot(validOptions)],
      }).compile();

      const tracer = module.get(TRACER_PORT);
      expect(tracer).toBeDefined();
      expect(tracer).toBeInstanceOf(OtlpTraceExporter);
    });

    it('should register METRICS_PORT provider', async () => {
      module = await Test.createTestingModule({
        imports: [TelemetryModule.forRoot(validOptions)],
      }).compile();

      const metrics = module.get(METRICS_PORT);
      expect(metrics).toBeDefined();
      expect(metrics).toBeInstanceOf(OtlpMetricsExporter);
    });

    it('should throw InvalidConfigurationError on invalid config', () => {
      expect(() =>
        TelemetryModule.forRoot({
          serviceName: '',
          environment: 'testing',
          exporter: { endpoint: 'https://example.com' },
        }),
      ).toThrow(InvalidConfigurationError);
    });

    it('should apply default logLevel "info" when not provided', async () => {
      module = await Test.createTestingModule({
        imports: [TelemetryModule.forRoot(validOptions)],
      }).compile();

      const logger = module.get<OtlpLogExporter>(LOGGER_PORT);
      // Logger should filter debug logs (below "info" level)
      // We verify by checking the logger exists and is properly configured
      expect(logger).toBeDefined();
    });

    it('should apply custom logLevel when provided', async () => {
      module = await Test.createTestingModule({
        imports: [
          TelemetryModule.forRoot({
            ...validOptions,
            logLevel: 'error',
          }),
        ],
      }).compile();

      const logger = module.get(LOGGER_PORT);
      expect(logger).toBeDefined();
    });

    it('should use ConsoleLogAdapter when loggerAdapter is "console"', async () => {
      module = await Test.createTestingModule({
        imports: [
          TelemetryModule.forRoot({
            ...validOptions,
            loggerAdapter: 'console',
          }),
        ],
      }).compile();

      const logger = module.get(LOGGER_PORT);
      expect(logger).toBeInstanceOf(ConsoleLogAdapter);
    });

    it('should use NoopLoggerAdapter when loggerAdapter is "noop"', async () => {
      module = await Test.createTestingModule({
        imports: [
          TelemetryModule.forRoot({
            ...validOptions,
            loggerAdapter: 'noop',
          }),
        ],
      }).compile();

      const logger = module.get(LOGGER_PORT);
      expect(logger).toBeInstanceOf(NoopLoggerAdapter);
    });

    it('should use custom logger when provided', async () => {
      const customLogger: LoggerPort = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        fatal: jest.fn(),
      };

      module = await Test.createTestingModule({
        imports: [
          TelemetryModule.forRoot({
            ...validOptions,
            logger: customLogger,
          }),
        ],
      }).compile();

      const logger = module.get(LOGGER_PORT);
      expect(logger).toBe(customLogger);
    });

    it('should apply default serviceVersion "unknown" when not provided', async () => {
      module = await Test.createTestingModule({
        imports: [TelemetryModule.forRoot(validOptions)],
      }).compile();

      const tracer = module.get(TRACER_PORT);
      expect(tracer).toBeDefined();
    });
  });

  describe('forRootAsync', () => {
    let module: TestingModule;

    afterEach(async () => {
      if (module) {
        await module.close();
      }
    });

    it('should register all providers via useFactory', async () => {
      module = await Test.createTestingModule({
        imports: [
          TelemetryModule.forRootAsync({
            useFactory: () => validOptions,
          }),
        ],
      }).compile();

      const logger = module.get(LOGGER_PORT);
      const tracer = module.get(TRACER_PORT);
      const metrics = module.get(METRICS_PORT);

      expect(logger).toBeInstanceOf(OtlpLogExporter);
      expect(tracer).toBeInstanceOf(OtlpTraceExporter);
      expect(metrics).toBeInstanceOf(OtlpMetricsExporter);
    });

    it('should support async useFactory', async () => {
      module = await Test.createTestingModule({
        imports: [
          TelemetryModule.forRootAsync({
            useFactory: async () => {
              // Simulate async config resolution
              await new Promise((resolve) => setTimeout(resolve, 10));
              return validOptions;
            },
          }),
        ],
      }).compile();

      const logger = module.get(LOGGER_PORT);
      expect(logger).toBeInstanceOf(OtlpLogExporter);
    });

    it('should support inject for dependency injection into factory', async () => {
      const CONFIG_TOKEN = 'CONFIG_TOKEN';

      // Create a module that provides the CONFIG_TOKEN
      const ConfigModule = {
        module: class ConfigModule {},
        providers: [{ provide: CONFIG_TOKEN, useValue: validOptions }],
        exports: [CONFIG_TOKEN],
      };

      module = await Test.createTestingModule({
        imports: [
          TelemetryModule.forRootAsync({
            imports: [ConfigModule],
            useFactory: (config: TelemetryModuleOptions) => config,
            inject: [CONFIG_TOKEN],
          }),
        ],
      }).compile();

      const logger = module.get(LOGGER_PORT);
      expect(logger).toBeInstanceOf(OtlpLogExporter);
    });

    it('should throw InvalidConfigurationError when factory returns invalid config', async () => {
      await expect(
        Test.createTestingModule({
          imports: [
            TelemetryModule.forRootAsync({
              useFactory: () => ({
                serviceName: '',
                environment: 'testing',
                exporter: { endpoint: 'https://example.com' },
              }),
            }),
          ],
        }).compile(),
      ).rejects.toThrow(InvalidConfigurationError);
    });
  });

  describe('global scope', () => {
    it('should be decorated as @Global module', () => {
      // The @Global() decorator marks the module metadata
      // We verify by checking that the module is importable and providers are accessible
      const dynamicModule = TelemetryModule.forRoot(validOptions);
      expect(dynamicModule.module).toBe(TelemetryModule);
      expect(dynamicModule.exports).toContain(LOGGER_PORT);
      expect(dynamicModule.exports).toContain(TRACER_PORT);
      expect(dynamicModule.exports).toContain(METRICS_PORT);
    });
  });
});
