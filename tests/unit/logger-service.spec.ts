import { LoggerService, LogHandler } from '../../src/telemetry/logger-service';
import { ResolvedTelemetryConfig } from '../../src/telemetry/config-validator';
import { contextManager } from '../../src/telemetry/context-manager';
import { StructuredLog } from '../../src/types';
import { SpanPort } from '../../src/ports/tracer.port';

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

function createMockSpan(traceId: string, spanId: string): SpanPort {
  return {
    traceId,
    spanId,
    name: 'test-span',
    setAttribute: jest.fn(),
    addEvent: jest.fn(),
    recordError: jest.fn(),
    setStatus: jest.fn(),
    end: jest.fn(),
  };
}

describe('LoggerService', () => {
  afterEach(() => {
    contextManager.clear();
  });

  describe('log level filtering', () => {
    it('should discard logs below configured minimum level', () => {
      const config = createConfig({ logLevel: 'warn' });
      const logger = new LoggerService(config);

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');
      logger.fatal('fatal message');

      const buffer = logger.getLogBuffer();
      expect(buffer).toHaveLength(3);
      expect(buffer[0].level).toBe('warn');
      expect(buffer[1].level).toBe('error');
      expect(buffer[2].level).toBe('fatal');
    });

    it('should allow all logs when level is debug', () => {
      const config = createConfig({ logLevel: 'debug' });
      const logger = new LoggerService(config);

      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');
      logger.fatal('fatal');

      expect(logger.getLogBuffer()).toHaveLength(5);
    });

    it('should only allow fatal when level is fatal', () => {
      const config = createConfig({ logLevel: 'fatal' });
      const logger = new LoggerService(config);

      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');
      logger.fatal('fatal');

      const buffer = logger.getLogBuffer();
      expect(buffer).toHaveLength(1);
      expect(buffer[0].level).toBe('fatal');
    });
  });

  describe('structured log building', () => {
    it('should build a StructuredLog with all required fields', () => {
      const config = createConfig();
      const logger = new LoggerService(config);

      logger.info('Hello world', { key: 'value' });

      const buffer = logger.getLogBuffer();
      expect(buffer).toHaveLength(1);

      const log = buffer[0];
      expect(log.timestamp).toBeDefined();
      expect(new Date(log.timestamp).toISOString()).toBe(log.timestamp);
      expect(log.level).toBe('info');
      expect(log.message).toBe('Hello world');
      expect(log.context).toEqual({ key: 'value' });
      expect(log.resource).toEqual({
        'service.name': 'test-service',
        'service.version': '1.0.0',
        'deployment.environment': 'test',
      });
    });

    it('should set context to undefined when not provided', () => {
      const config = createConfig();
      const logger = new LoggerService(config);

      logger.info('No context');

      const log = logger.getLogBuffer()[0];
      expect(log.context).toBeUndefined();
    });

    it('should set correlation to undefined when no active span', () => {
      const config = createConfig();
      const logger = new LoggerService(config);

      logger.info('No correlation');

      const log = logger.getLogBuffer()[0];
      expect(log.correlation).toBeUndefined();
    });
  });

  describe('correlation context enrichment', () => {
    it('should auto-enrich logs with traceId and spanId from active span', () => {
      const config = createConfig();
      const logger = new LoggerService(config);

      const mockSpan = createMockSpan('trace-abc-123', 'span-def-456');
      contextManager.setActiveSpan(mockSpan);

      logger.info('Enriched log');

      const log = logger.getLogBuffer()[0];
      expect(log.correlation).toEqual({
        traceId: 'trace-abc-123',
        spanId: 'span-def-456',
      });
    });

    it('should reflect the current active span at time of logging', () => {
      const config = createConfig();
      const logger = new LoggerService(config);

      const span1 = createMockSpan('trace-1', 'span-1');
      const span2 = createMockSpan('trace-1', 'span-2');

      contextManager.setActiveSpan(span1);
      logger.info('First log');

      contextManager.setActiveSpan(span2);
      logger.info('Second log');

      const buffer = logger.getLogBuffer();
      expect(buffer[0].correlation?.spanId).toBe('span-1');
      expect(buffer[1].correlation?.spanId).toBe('span-2');
    });
  });

  describe('log handler callback', () => {
    it('should pass logs to handler when provided', () => {
      const config = createConfig();
      const handler: LogHandler = jest.fn();
      const logger = new LoggerService(config, handler);

      logger.info('Handled log');

      expect(handler).toHaveBeenCalledTimes(1);
      expect((handler as jest.Mock).mock.calls[0][0].message).toBe('Handled log');
      expect(logger.getLogBuffer()).toHaveLength(0);
    });
  });

  describe('fail-safe behavior', () => {
    it('should never throw even if context manager throws', () => {
      const config = createConfig();
      const logger = new LoggerService(config);

      // Temporarily make contextManager throw
      const originalGet = contextManager.getCorrelationContext.bind(contextManager);
      jest.spyOn(contextManager, 'getCorrelationContext').mockImplementation(() => {
        throw new Error('Context explosion');
      });

      expect(() => logger.info('Should not throw')).not.toThrow();

      (contextManager.getCorrelationContext as jest.Mock).mockRestore();
    });

    it('should never throw even if log handler throws', () => {
      const config = createConfig();
      const handler: LogHandler = () => {
        throw new Error('Handler explosion');
      };
      const logger = new LoggerService(config, handler);

      expect(() => logger.info('Should not throw')).not.toThrow();
    });
  });

  describe('clearLogBuffer', () => {
    it('should clear the internal buffer', () => {
      const config = createConfig();
      const logger = new LoggerService(config);

      logger.info('Log 1');
      logger.info('Log 2');
      expect(logger.getLogBuffer()).toHaveLength(2);

      logger.clearLogBuffer();
      expect(logger.getLogBuffer()).toHaveLength(0);
    });
  });

  describe('all log methods', () => {
    it.each(['debug', 'info', 'warn', 'error', 'fatal'] as const)(
      'should emit a log with level %s',
      (level) => {
        const config = createConfig({ logLevel: 'debug' });
        const logger = new LoggerService(config);

        logger[level](`${level} message`, { level });

        const buffer = logger.getLogBuffer();
        expect(buffer).toHaveLength(1);
        expect(buffer[0].level).toBe(level);
        expect(buffer[0].message).toBe(`${level} message`);
        expect(buffer[0].context).toEqual({ level });
      },
    );
  });
});
