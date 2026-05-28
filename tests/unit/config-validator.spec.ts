import { ConfigValidator, ResolvedTelemetryConfig } from '../../src/telemetry/config-validator';
import { InvalidConfigurationError } from '../../src/errors';
import { TelemetryConfig } from '../../src/types';

describe('ConfigValidator', () => {
  const validConfig: TelemetryConfig = {
    serviceName: 'test-service',
    environment: 'production',
    exporter: {
      endpoint: 'https://otlp.example.com/v1',
    },
  };

  describe('validate - required fields', () => {
    it('should throw InvalidConfigurationError when serviceName is missing', () => {
      const config = { ...validConfig, serviceName: '' };

      expect(() => ConfigValidator.validate(config)).toThrow(InvalidConfigurationError);
      try {
        ConfigValidator.validate(config);
      } catch (e) {
        const err = e as InvalidConfigurationError;
        expect(err.field).toBe('serviceName');
      }
    });

    it('should throw InvalidConfigurationError when environment is missing', () => {
      const config = { ...validConfig, environment: '' };

      expect(() => ConfigValidator.validate(config)).toThrow(InvalidConfigurationError);
      try {
        ConfigValidator.validate(config);
      } catch (e) {
        const err = e as InvalidConfigurationError;
        expect(err.field).toBe('environment');
      }
    });

    it('should throw InvalidConfigurationError when exporter.endpoint is missing', () => {
      const config = { ...validConfig, exporter: { endpoint: '' } };

      expect(() => ConfigValidator.validate(config)).toThrow(InvalidConfigurationError);
      try {
        ConfigValidator.validate(config);
      } catch (e) {
        const err = e as InvalidConfigurationError;
        expect(err.field).toBe('exporter.endpoint');
      }
    });

    it('should throw InvalidConfigurationError when serviceName is whitespace only', () => {
      const config = { ...validConfig, serviceName: '   ' };

      expect(() => ConfigValidator.validate(config)).toThrow(InvalidConfigurationError);
    });

    it('should throw InvalidConfigurationError when environment is whitespace only', () => {
      const config = { ...validConfig, environment: '  \t  ' };

      expect(() => ConfigValidator.validate(config)).toThrow(InvalidConfigurationError);
    });
  });

  describe('validate - defaults', () => {
    it('should apply default logLevel="info" when not provided', () => {
      const result = ConfigValidator.validate(validConfig);

      expect(result.logLevel).toBe('info');
    });

    it('should apply default serviceVersion="unknown" when not provided', () => {
      const result = ConfigValidator.validate(validConfig);

      expect(result.serviceVersion).toBe('unknown');
    });

    it('should apply default protocol="http" when not provided', () => {
      const result = ConfigValidator.validate(validConfig);

      expect(result.exporter.protocol).toBe('http');
    });

    it('should apply default timeout=30000 when not provided', () => {
      const result = ConfigValidator.validate(validConfig);

      expect(result.exporter.timeout).toBe(30000);
    });

    it('should apply default retry.maxAttempts=3 when not provided', () => {
      const result = ConfigValidator.validate(validConfig);

      expect(result.exporter.retry.maxAttempts).toBe(3);
    });

    it('should apply default retry.baseInterval=1000 when not provided', () => {
      const result = ConfigValidator.validate(validConfig);

      expect(result.exporter.retry.baseInterval).toBe(1000);
    });

    it('should apply default retry.maxInterval=60000 when not provided', () => {
      const result = ConfigValidator.validate(validConfig);

      expect(result.exporter.retry.maxInterval).toBe(60000);
    });
  });

  describe('validate - preserves provided values', () => {
    it('should preserve provided logLevel', () => {
      const config: TelemetryConfig = { ...validConfig, logLevel: 'debug' };
      const result = ConfigValidator.validate(config);

      expect(result.logLevel).toBe('debug');
    });

    it('should preserve provided serviceVersion', () => {
      const config: TelemetryConfig = { ...validConfig, serviceVersion: '1.2.3' };
      const result = ConfigValidator.validate(config);

      expect(result.serviceVersion).toBe('1.2.3');
    });

    it('should preserve provided protocol', () => {
      const config: TelemetryConfig = {
        ...validConfig,
        exporter: { ...validConfig.exporter, protocol: 'grpc' },
      };
      const result = ConfigValidator.validate(config);

      expect(result.exporter.protocol).toBe('grpc');
    });

    it('should preserve provided timeout', () => {
      const config: TelemetryConfig = {
        ...validConfig,
        exporter: { ...validConfig.exporter, timeout: 5000 },
      };
      const result = ConfigValidator.validate(config);

      expect(result.exporter.timeout).toBe(5000);
    });

    it('should preserve provided retry config', () => {
      const config: TelemetryConfig = {
        ...validConfig,
        exporter: {
          ...validConfig.exporter,
          retry: { maxAttempts: 5, baseInterval: 2000, maxInterval: 120000 },
        },
      };
      const result = ConfigValidator.validate(config);

      expect(result.exporter.retry.maxAttempts).toBe(5);
      expect(result.exporter.retry.baseInterval).toBe(2000);
      expect(result.exporter.retry.maxInterval).toBe(120000);
    });

    it('should preserve provided headers', () => {
      const config: TelemetryConfig = {
        ...validConfig,
        exporter: {
          ...validConfig.exporter,
          headers: { Authorization: 'Basic abc123' },
        },
      };
      const result = ConfigValidator.validate(config);

      expect(result.exporter.headers).toEqual({ Authorization: 'Basic abc123' });
    });
  });

  describe('validate - valid config returns resolved config', () => {
    it('should return a fully resolved config with all fields populated', () => {
      const result = ConfigValidator.validate(validConfig);

      expect(result).toEqual({
        serviceName: 'test-service',
        serviceVersion: 'unknown',
        environment: 'production',
        logLevel: 'info',
        exporter: {
          endpoint: 'https://otlp.example.com/v1',
          headers: undefined,
          protocol: 'http',
          timeout: 30000,
          retry: {
            maxAttempts: 3,
            baseInterval: 1000,
            maxInterval: 60000,
          },
        },
      });
    });
  });
});
