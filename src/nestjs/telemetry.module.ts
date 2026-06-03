import { Module, Global, DynamicModule, Provider } from '@nestjs/common';
import { LOGGER_PORT } from '../ports/logger.port';
import { TRACER_PORT } from '../ports/tracer.port';
import { METRICS_PORT } from '../ports/metrics.port';
import { ConfigValidator, ResolvedTelemetryConfig } from '../telemetry/config-validator';
import { OtlpLogExporter } from '../adapters/otlp-log-exporter';
import { OtlpTraceExporter } from '../adapters/otlp-trace-exporter';
import { OtlpMetricsExporter } from '../adapters/otlp-metrics-exporter';
import { registerGlobalTracer } from '../telemetry/global-tracer-registration';
import { LogLevel, ExporterConfig } from '../types';

/**
 * Configuration options for TelemetryModule.forRoot().
 * Maps directly to TelemetryConfig but named for NestJS module convention.
 */
export interface TelemetryModuleOptions {
  serviceName: string;
  serviceVersion?: string;
  environment: string;
  logLevel?: LogLevel;
  exporter: ExporterConfig;
}

/**
 * Async configuration options for TelemetryModule.forRootAsync().
 * Supports useFactory pattern for resolving config from other providers.
 */
export interface TelemetryModuleAsyncOptions {
  imports?: any[];
  useFactory: (...args: any[]) => TelemetryModuleOptions | Promise<TelemetryModuleOptions>;
  inject?: any[];
}

/**
 * Internal token used to store the resolved telemetry config.
 */
const TELEMETRY_MODULE_OPTIONS = 'TELEMETRY_MODULE_OPTIONS';

/**
 * TelemetryModule provides NestJS integration for the telemetry library.
 *
 * Registered as @Global() so that LOGGER_PORT, TRACER_PORT, and METRICS_PORT
 * tokens are available for injection in all modules without re-importing.
 *
 * Usage:
 * ```typescript
 * // Synchronous configuration
 * TelemetryModule.forRoot({
 *   serviceName: 'my-service',
 *   environment: 'production',
 *   exporter: { endpoint: 'https://otlp.grafana.net/otlp', headers: { Authorization: '...' } },
 * });
 *
 * // Async configuration (e.g., from ConfigService)
 * TelemetryModule.forRootAsync({
 *   imports: [ConfigModule],
 *   useFactory: (configService: ConfigService) => ({
 *     serviceName: configService.get('SERVICE_NAME'),
 *     environment: configService.get('ENVIRONMENT'),
 *     exporter: { endpoint: configService.get('OTLP_ENDPOINT') },
 *   }),
 *   inject: [ConfigService],
 * });
 * ```
 */
@Global()
@Module({})
export class TelemetryModule {
  /**
   * Registers the telemetry module with synchronous configuration.
   * Validates config, creates adapters, and registers providers for all port tokens.
   */
  static forRoot(options: TelemetryModuleOptions): DynamicModule {
    const resolvedConfig = ConfigValidator.validate(options);

    // Register global TracerProvider and W3CTraceContextPropagator with @opentelemetry/api.
    // This enables propagation.inject() to produce valid traceparent headers
    // in any library that depends on the OTel API (e.g., messaging libs).
    registerGlobalTracer(resolvedConfig);

    const providers: Provider[] = [
      {
        provide: LOGGER_PORT,
        useValue: new OtlpLogExporter(resolvedConfig),
      },
      {
        provide: TRACER_PORT,
        useValue: new OtlpTraceExporter(resolvedConfig),
      },
      {
        provide: METRICS_PORT,
        useValue: new OtlpMetricsExporter(resolvedConfig),
      },
    ];

    return {
      module: TelemetryModule,
      providers,
      exports: [LOGGER_PORT, TRACER_PORT, METRICS_PORT],
    };
  }

  /**
   * Registers the telemetry module with asynchronous configuration.
   * Uses the useFactory pattern to resolve config from other providers (e.g., ConfigService).
   */
  static forRootAsync(options: TelemetryModuleAsyncOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: TELEMETRY_MODULE_OPTIONS,
      useFactory: options.useFactory,
      inject: options.inject ?? [],
    };

    const loggerProvider: Provider = {
      provide: LOGGER_PORT,
      useFactory: (moduleOptions: TelemetryModuleOptions) => {
        const resolvedConfig = ConfigValidator.validate(moduleOptions);
        return new OtlpLogExporter(resolvedConfig);
      },
      inject: [TELEMETRY_MODULE_OPTIONS],
    };

    const tracerProvider: Provider = {
      provide: TRACER_PORT,
      useFactory: (moduleOptions: TelemetryModuleOptions) => {
        const resolvedConfig = ConfigValidator.validate(moduleOptions);
        // Register global TracerProvider and W3CTraceContextPropagator.
        // Must happen before any library calls propagation.inject().
        registerGlobalTracer(resolvedConfig);
        return new OtlpTraceExporter(resolvedConfig);
      },
      inject: [TELEMETRY_MODULE_OPTIONS],
    };

    const metricsProvider: Provider = {
      provide: METRICS_PORT,
      useFactory: (moduleOptions: TelemetryModuleOptions) => {
        const resolvedConfig = ConfigValidator.validate(moduleOptions);
        return new OtlpMetricsExporter(resolvedConfig);
      },
      inject: [TELEMETRY_MODULE_OPTIONS],
    };

    return {
      module: TelemetryModule,
      imports: options.imports ?? [],
      providers: [optionsProvider, loggerProvider, tracerProvider, metricsProvider],
      exports: [LOGGER_PORT, TRACER_PORT, METRICS_PORT],
    };
  }
}
