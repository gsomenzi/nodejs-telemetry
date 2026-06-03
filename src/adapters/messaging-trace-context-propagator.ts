import { ContextPropagator } from './context-propagator';
import { contextManager } from '../telemetry/context-manager';
import { Span } from '../telemetry/span';

/**
 * Carrier used to transport trace context across service boundaries.
 * Follows the W3C Trace Context format where keys are header names
 * (e.g. 'traceparent', 'tracestate') and values are their string representations.
 */
export type TraceCarrier = Record<string, string>;

/**
 * Port interface matching @gsomenzi/nodejs-messaging's TraceContextPropagatorPort.
 * Duplicated here to avoid a circular dependency between the two packages.
 */
export interface TraceContextPropagatorPort {
    inject(): TraceCarrier;
    extract(carrier: TraceCarrier, fn: () => Promise<void>): Promise<void>;
}

/**
 * MessagingTraceContextPropagator bridges the telemetry library's internal
 * context (AsyncLocalStorage-based contextManager) with the messaging library's
 * trace propagation interface.
 *
 * The default OtelTraceContextPropagator in the messaging lib uses
 * `@opentelemetry/api`'s `context.active()` which is unaware of spans created
 * by this telemetry library's TracerPort. This adapter solves that by reading
 * the active span directly from the internal contextManager.
 *
 * Usage:
 * ```typescript
 * import { MessagingTraceContextPropagator } from '@gsomenzi/nodejs-telemetry';
 *
 * MessagingModule.forRoot({
 *   // ...
 *   tracePropagator: new MessagingTraceContextPropagator(),
 * });
 * ```
 */
export class MessagingTraceContextPropagator implements TraceContextPropagatorPort {
    private readonly propagator = new ContextPropagator();

    /**
     * Injects the current active span's trace context into a carrier object.
     *
     * Reads the active span from the internal contextManager (AsyncLocalStorage)
     * and serializes it into W3C traceparent/tracestate headers.
     *
     * @returns A carrier with trace context headers, or an empty object if no span is active.
     */
    inject(): TraceCarrier {
        const correlationContext = contextManager.getCorrelationContext();

        if (!correlationContext) {
            return {};
        }

        return this.propagator.inject(correlationContext);
    }

    /**
     * Extracts trace context from a carrier and executes a function within that context.
     *
     * Parses the W3C traceparent header from the carrier, creates a span linked to
     * the propagated trace, sets it as active in the contextManager, and runs the
     * provided function. The span is restored after execution.
     *
     * @param carrier - The trace context carrier extracted from event metadata.
     * @param fn - The function to execute within the restored trace context.
     */
    async extract(carrier: TraceCarrier, fn: () => Promise<void>): Promise<void> {
        const extracted = this.propagator.extract(carrier);

        if (extracted) {
            // Create a linked span within the propagated trace context
            const span = new Span(`consume`, extracted.traceId, extracted.spanId);
            contextManager.setActiveSpan(span);
            try {
                await fn();
            } finally {
                contextManager.restoreParentSpan();
            }
        } else {
            await fn();
        }
    }
}
