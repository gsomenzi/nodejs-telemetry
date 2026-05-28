import { TracerPort, SpanPort, SpanOptions } from '../ports/tracer.port';
import { ResolvedTelemetryConfig } from '../telemetry/config-validator';
import { SpanData, ResourceAttributes } from '../types';
import { Span, NoopSpan } from '../telemetry/span';
import { contextManager } from '../telemetry/context-manager';
import { executeWithRetry } from './retry-policy';
import { randomUUID } from 'node:crypto';

/**
 * Default batch flush interval in milliseconds.
 */
const DEFAULT_FLUSH_INTERVAL_MS = 5000;

/**
 * Default maximum batch size before forcing a flush.
 */
const DEFAULT_MAX_BATCH_SIZE = 512;

/**
 * ExportableSpan extends Span to hook into span.end() and trigger export.
 * When end() is called, it notifies the exporter via the onEnd callback.
 */
class ExportableSpan extends Span {
  private readonly _parentSpanId: string | undefined;
  private readonly _onEnd: (span: ExportableSpan) => void;

  constructor(
    name: string,
    traceId: string,
    spanId: string,
    parentSpanId: string | undefined,
    onEnd: (span: ExportableSpan) => void,
  ) {
    super(name, traceId, spanId);
    this._parentSpanId = parentSpanId;
    this._onEnd = onEnd;
  }

  get parentSpanId(): string | undefined {
    return this._parentSpanId;
  }

  end(): void {
    if (this.ended) return;
    super.end();
    try {
      this._onEnd(this);
    } catch {
      // Never throw — swallow export errors
    }
  }
}

/**
 * OtlpTraceExporter implements TracerPort and exports completed spans
 * to an OTLP-compatible endpoint (e.g., Grafana Cloud) via HTTP JSON.
 *
 * - Wraps TracerService logic internally for span creation/management
 * - Hooks into span completion to batch and export span data
 * - Authenticates requests using configured headers
 * - Applies retry logic with exponential backoff on network failures
 * - Methods never throw to the caller
 */
export class OtlpTraceExporter implements TracerPort {
  private readonly config: ResolvedTelemetryConfig;
  private readonly resource: ResourceAttributes;
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly timeout: number;
  private readonly spanBuffer: SpanData[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly maxBatchSize: number;
  private _shutdown = false;

  constructor(config: ResolvedTelemetryConfig) {
    this.config = config;
    this.resource = {
      'service.name': config.serviceName,
      'service.version': config.serviceVersion,
      'deployment.environment': config.environment,
    };

    // OTLP traces endpoint
    const base = config.exporter.endpoint.replace(/\/$/, '');
    this.endpoint = `${base}/v1/traces`;

    // Auth and config headers
    this.headers = {
      'Content-Type': 'application/json',
      ...(config.exporter.headers ?? {}),
    };

    this.timeout = config.exporter.timeout;
    this.maxBatchSize = DEFAULT_MAX_BATCH_SIZE;

    // Start periodic flush
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, DEFAULT_FLUSH_INTERVAL_MS);

    // Unref the timer so it doesn't prevent process exit
    if (this.flushTimer && typeof this.flushTimer.unref === 'function') {
      this.flushTimer.unref();
    }
  }

  /**
   * Creates a new span and sets it as the active span in the context.
   * When the span ends, its data is batched for export.
   *
   * Never throws — returns NoopSpan on any error.
   */
  startSpan(name: string, options?: SpanOptions): SpanPort {
    try {
      let traceId: string;
      let parentSpanId: string | undefined;

      // Determine traceId: inherit from parent or generate new
      if (options?.parentSpan) {
        traceId = options.parentSpan.traceId;
        parentSpanId = options.parentSpan.spanId;
      } else {
        const activeSpan = contextManager.getActiveSpan();
        if (activeSpan) {
          traceId = activeSpan.traceId;
          parentSpanId = activeSpan.spanId;
        } else {
          traceId = randomUUID();
          parentSpanId = undefined;
        }
      }

      const spanId = randomUUID();
      const span = new ExportableSpan(
        name,
        traceId,
        spanId,
        parentSpanId,
        (completedSpan) => this.onSpanEnd(completedSpan),
      );

      // Apply initial attributes if provided
      if (options?.attributes) {
        for (const [key, value] of Object.entries(options.attributes)) {
          span.setAttribute(key, value);
        }
      }

      // Set as active span in context
      contextManager.setActiveSpan(span);

      return span;
    } catch {
      // Never throw — return NoopSpan on any error
      return new NoopSpan();
    }
  }

  /**
   * Returns the currently active span from the context, or null if no span is active.
   */
  getActiveSpan(): SpanPort | null {
    try {
      return contextManager.getActiveSpan();
    } catch {
      return null;
    }
  }

  /**
   * Flushes all buffered spans to the OTLP endpoint.
   * Called periodically and on shutdown.
   */
  async flush(): Promise<void> {
    if (this.spanBuffer.length === 0) return;

    // Drain the buffer
    const batch = this.spanBuffer.splice(0, this.spanBuffer.length);

    await this.exportBatch(batch);
  }

  /**
   * Gracefully shuts down the exporter: stops the flush timer and
   * flushes any remaining buffered spans.
   */
  async shutdown(): Promise<void> {
    this._shutdown = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flush();
  }

  /**
   * Returns the current span buffer for testing purposes.
   */
  getSpanBuffer(): SpanData[] {
    return this.spanBuffer;
  }

  /**
   * Called when a span ends. Converts the span to SpanData and adds it to the buffer.
   * If the buffer exceeds maxBatchSize, triggers an immediate flush.
   */
  private onSpanEnd(span: ExportableSpan): void {
    if (this._shutdown) return;

    const spanData: SpanData = {
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      name: span.name,
      status: span.status,
      startTime: span.startTime,
      endTime: span.endTime!,
      attributes: span.attributes,
      events: span.events,
      resource: this.resource,
    };

    this.spanBuffer.push(spanData);

    // Flush immediately if batch size exceeded
    if (this.spanBuffer.length >= this.maxBatchSize) {
      void this.flush();
    }
  }

  /**
   * Exports a batch of spans to the OTLP endpoint with retry logic.
   */
  private async exportBatch(batch: SpanData[]): Promise<void> {
    const payload = JSON.stringify({ resourceSpans: this.buildResourceSpans(batch) });

    await executeWithRetry(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: this.headers,
          body: payload,
          signal: controller.signal,
        });

        if (!response.ok) {
          const error = new Error(
            `OTLP export failed with status ${response.status}: ${response.statusText}`,
          );
          (error as NodeJS.ErrnoException).code = 'ECONNREFUSED';
          throw error;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }, this.config.exporter.retry);
  }

  /**
   * Builds the OTLP resource spans payload structure.
   */
  private buildResourceSpans(batch: SpanData[]): unknown[] {
    return [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: this.resource['service.name'] } },
            { key: 'service.version', value: { stringValue: this.resource['service.version'] } },
            {
              key: 'deployment.environment',
              value: { stringValue: this.resource['deployment.environment'] },
            },
          ],
        },
        scopeSpans: [
          {
            spans: batch.map((span) => this.serializeSpan(span)),
          },
        ],
      },
    ];
  }

  /**
   * Serializes a SpanData into the OTLP JSON span format.
   */
  private serializeSpan(span: SpanData): unknown {
    return {
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId ?? '',
      name: span.name,
      kind: 1, // SPAN_KIND_INTERNAL
      startTimeUnixNano: this.isoToNano(span.startTime),
      endTimeUnixNano: this.isoToNano(span.endTime),
      attributes: this.serializeAttributes(span.attributes),
      events: span.events.map((event) => ({
        name: event.name,
        timeUnixNano: this.isoToNano(event.timestamp),
        attributes: event.attributes
          ? this.serializeAttributes(event.attributes as Record<string, string | number | boolean>)
          : [],
      })),
      status: {
        code: this.statusToCode(span.status),
      },
    };
  }

  /**
   * Converts ISO 8601 timestamp to nanoseconds string (OTLP format).
   */
  private isoToNano(iso: string): string {
    const ms = new Date(iso).getTime();
    return (BigInt(ms) * BigInt(1_000_000)).toString();
  }

  /**
   * Converts SpanStatus to OTLP status code.
   */
  private statusToCode(status: string): number {
    switch (status) {
      case 'OK':
        return 1;
      case 'ERROR':
        return 2;
      default:
        return 0; // UNSET
    }
  }

  /**
   * Serializes attributes to OTLP key-value format.
   */
  private serializeAttributes(
    attrs: Record<string, string | number | boolean>,
  ): { key: string; value: Record<string, unknown> }[] {
    return Object.entries(attrs).map(([key, value]) => ({
      key,
      value: this.serializeAttributeValue(value),
    }));
  }

  /**
   * Serializes a single attribute value to OTLP format.
   */
  private serializeAttributeValue(value: string | number | boolean): Record<string, unknown> {
    if (typeof value === 'string') {
      return { stringValue: value };
    }
    if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        return { intValue: value };
      }
      return { doubleValue: value };
    }
    if (typeof value === 'boolean') {
      return { boolValue: value };
    }
    return { stringValue: String(value) };
  }
}
