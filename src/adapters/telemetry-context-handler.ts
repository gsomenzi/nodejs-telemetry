import { MessageContextHandlerPort } from '../ports/message-context-handler.port';
import { ContextPropagator } from './context-propagator';
import { TracerPort, SpanPort } from '../ports/tracer.port';
import { contextManager } from '../telemetry/context-manager';
import { Span } from '../telemetry/span';

/**
 * TelemetryContextHandler implements MessageContextHandlerPort to provide
 * automatic W3C Trace Context propagation for messaging/event systems.
 *
 * This adapter is designed to be plugged into a messaging library as a
 * context handler slot, enabling distributed tracing across microservices
 * without manual propagation logic in application code.
 *
 * Usage:
 * ```typescript
 * import { TelemetryContextHandler, TelemetryFactory } from '@gsomenzi/node-telemetry';
 *
 * const { tracer } = TelemetryFactory.create({ ... });
 * const contextHandler = new TelemetryContextHandler(tracer);
 *
 * // Plug into your messaging library
 * const broker = new MessageBroker({ contextHandler });
 * ```
 */
export class TelemetryContextHandler implements MessageContextHandlerPort {
  private readonly propagator = new ContextPropagator();
  private activeSpan: SpanPort | null = null;

  constructor(private readonly tracer: TracerPort) {}

  /**
   * Injects trace propagation headers into message metadata.
   *
   * Reads the currently active span from the async context (via contextManager)
   * and serializes its traceId + spanId into W3C traceparent format.
   *
   * If no span is active, returns metadata unchanged.
   */
  onPublish(metadata: Record<string, string>): Record<string, string> {
    const correlationContext = contextManager.getCorrelationContext();

    if (!correlationContext) {
      return metadata;
    }

    const traceHeaders = this.propagator.inject(correlationContext);

    return { ...metadata, ...traceHeaders };
  }

  /**
   * Extracts trace context from message metadata and creates a child span.
   *
   * If traceparent is found in metadata, creates a span within the same trace.
   * Otherwise, creates a new root span via the tracer.
   *
   * The created span is set as active in the contextManager, so any downstream
   * code (logs, child spans) automatically inherits the trace context.
   */
  onConsume(metadata: Record<string, string>, eventName: string): void {
    const extractedContext = this.propagator.extract(metadata);

    if (extractedContext) {
      // Create a child span linked to the propagated trace
      this.activeSpan = new Span(`consume:${eventName}`, extractedContext.traceId);
      contextManager.setActiveSpan(this.activeSpan);
    } else {
      // No propagated context — start a new trace
      this.activeSpan = this.tracer.startSpan(`consume:${eventName}`);
    }
  }

  /**
   * Ends the active span with the appropriate status.
   *
   * Called by the messaging library when the event handler finishes.
   * If an error is provided, records it on the span and sets status to ERROR.
   */
  onConsumeEnd(error?: Error): void {
    if (!this.activeSpan) {
      return;
    }

    if (error) {
      this.activeSpan.recordError(error);
      this.activeSpan.setStatus('ERROR');
    } else {
      this.activeSpan.setStatus('OK');
    }

    this.activeSpan.end();
    this.activeSpan = null;
  }
}
