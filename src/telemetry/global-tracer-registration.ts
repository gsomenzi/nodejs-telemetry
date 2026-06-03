import { propagation, trace, context } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { ResolvedTelemetryConfig } from './config-validator';

/**
 * Tracks whether the global TracerProvider has already been registered.
 * This ensures idempotency — multiple calls to registerGlobalTracer are safe.
 */
let globalProviderRegistered = false;
let registeredProvider: NodeTracerProvider | null = null;

/**
 * Registers a global TracerProvider and W3CTraceContextPropagator with the
 * OpenTelemetry API singleton.
 *
 * This is critical for interoperability with other libraries that use
 * `@opentelemetry/api` (e.g., messaging libs that call `propagation.inject()`).
 * Without this registration, the OTel API returns noop implementations and
 * `propagation.inject()` produces empty carriers.
 *
 * This function is idempotent — calling it multiple times is safe.
 *
 * @param config - The resolved telemetry configuration
 */
export function registerGlobalTracer(config: ResolvedTelemetryConfig): void {
  if (globalProviderRegistered) {
    return;
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_VERSION]: config.serviceVersion,
    'deployment.environment': config.environment,
  });

  const traceExporter = new OTLPTraceExporter({
    url: `${config.exporter.endpoint.replace(/\/$/, '')}/v1/traces`,
    headers: config.exporter.headers ?? {},
    timeoutMillis: config.exporter.timeout,
  });

  registeredProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(traceExporter)],
  });

  // Register as the global TracerProvider — makes trace.getTracer() return real tracers
  registeredProvider.register();

  // Register W3C propagator — makes propagation.inject() serialize traceparent/tracestate
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());

  globalProviderRegistered = true;
}

/**
 * Shuts down the global TracerProvider, flushing any pending spans.
 * After shutdown, the provider is deregistered and a new one can be registered.
 *
 * This is called during application shutdown (e.g., TelemetryFactory.shutdown()).
 */
export async function shutdownGlobalTracer(): Promise<void> {
  if (!registeredProvider) {
    return;
  }

  try {
    await registeredProvider.shutdown();
  } catch {
    // Best-effort shutdown — never throw
  } finally {
    registeredProvider = null;
    globalProviderRegistered = false;
  }
}

/**
 * Returns whether the global TracerProvider has been registered.
 * Useful for testing and diagnostics.
 */
export function isGlobalTracerRegistered(): boolean {
  return globalProviderRegistered;
}
