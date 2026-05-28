import { randomUUID } from 'node:crypto';
import { TracerPort, SpanPort, SpanOptions } from '../ports/tracer.port';
import { contextManager } from './context-manager';
import { Span, NoopSpan } from './span';

/**
 * TracerService implements TracerPort, providing distributed tracing capabilities.
 *
 * - startSpan creates a new Span and sets it as active in the ContextManager
 * - If there's an active span, the new span inherits its traceId (child span)
 * - If no active span exists, a new traceId is generated (root span)
 * - startSpan never throws — returns NoopSpan on context corruption
 */
export class TracerService implements TracerPort {
  /**
   * Creates a new span and sets it as the active span in the context.
   *
   * If a parent span is active (either explicitly provided or from the context),
   * the new span inherits the parent's traceId. Otherwise, a new traceId is generated.
   *
   * This method never throws. If any error occurs during span creation,
   * a NoopSpan is returned to ensure the application continues functioning.
   */
  startSpan(name: string, options?: SpanOptions): SpanPort {
    try {
      let traceId: string;

      // Determine traceId: inherit from parent or generate new
      if (options?.parentSpan) {
        traceId = options.parentSpan.traceId;
      } else {
        const activeSpan = contextManager.getActiveSpan();
        if (activeSpan) {
          traceId = activeSpan.traceId;
        } else {
          traceId = randomUUID();
        }
      }

      const spanId = randomUUID();
      const span = new Span(name, traceId, spanId);

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
}
