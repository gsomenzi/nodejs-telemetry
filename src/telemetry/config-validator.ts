import { InvalidConfigurationError } from '../errors';
import { TelemetryConfig, ExporterConfig, RetryConfig } from '../types';

export interface ResolvedTelemetryConfig {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  exporter: ResolvedExporterConfig;
}

export interface ResolvedExporterConfig {
  endpoint: string;
  headers?: Record<string, string>;
  protocol: 'http' | 'grpc';
  timeout: number;
  retry: RetryConfig;
}

export class ConfigValidator {
  static validate(config: TelemetryConfig): ResolvedTelemetryConfig {
    ConfigValidator.validateRequired(config);

    return ConfigValidator.applyDefaults(config);
  }

  private static validateRequired(config: TelemetryConfig): void {
    if (!config.serviceName || config.serviceName.trim() === '') {
      throw new InvalidConfigurationError(
        'serviceName is required and cannot be empty',
        'serviceName',
        'required field is missing or empty',
      );
    }

    if (!config.environment || config.environment.trim() === '') {
      throw new InvalidConfigurationError(
        'environment is required and cannot be empty',
        'environment',
        'required field is missing or empty',
      );
    }

    if (!config.exporter) {
      throw new InvalidConfigurationError(
        'exporter configuration is required',
        'exporter',
        'required field is missing',
      );
    }

    if (!config.exporter.endpoint || config.exporter.endpoint.trim() === '') {
      throw new InvalidConfigurationError(
        'exporter.endpoint is required and cannot be empty',
        'exporter.endpoint',
        'required field is missing or empty',
      );
    }
  }

  private static applyDefaults(config: TelemetryConfig): ResolvedTelemetryConfig {
    const retry: RetryConfig = {
      maxAttempts: config.exporter.retry?.maxAttempts ?? 3,
      baseInterval: config.exporter.retry?.baseInterval ?? 1000,
      maxInterval: config.exporter.retry?.maxInterval ?? 60000,
    };

    const exporter: ResolvedExporterConfig = {
      endpoint: config.exporter.endpoint,
      headers: config.exporter.headers,
      protocol: config.exporter.protocol ?? 'http',
      timeout: config.exporter.timeout ?? 30000,
      retry,
    };

    return {
      serviceName: config.serviceName,
      serviceVersion: config.serviceVersion ?? 'unknown',
      environment: config.environment,
      logLevel: config.logLevel ?? 'info',
      exporter,
    };
  }
}
