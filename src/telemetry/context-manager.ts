import { AsyncLocalStorage } from 'node:async_hooks';
import { SpanPort } from '../ports/tracer.port';
import { CorrelationContext } from '../types';

interface ContextStore {
  spanStack: SpanPort[];
}

/**
 * Manages the active trace context using Node.js AsyncLocalStorage
 * for implicit propagation across async boundaries.
 *
 * Context is set when a span starts and automatically available to any code
 * running in the same async context — no wrapping callbacks or nesting required.
 */
class ContextManagerImpl {
  private readonly storage = new AsyncLocalStorage<ContextStore>();

  /**
   * Returns the CorrelationContext (traceId, spanId) from the active span,
   * or null if no active span exists.
   */
  getCorrelationContext(): CorrelationContext | null {
    const span = this.getActiveSpan();
    if (!span) {
      return null;
    }

    return {
      traceId: span.traceId,
      spanId: span.spanId,
    };
  }

  /**
   * Returns the currently active span, or null if no span is active
   * in the current async context.
   */
  getActiveSpan(): SpanPort | null {
    const store = this.storage.getStore();
    if (!store || store.spanStack.length === 0) {
      return null;
    }

    return store.spanStack[store.spanStack.length - 1];
  }

  /**
   * Pushes a span onto the context stack, making it the active span.
   * Nested spans are supported — when a span ends, the parent is restored.
   */
  setActiveSpan(span: SpanPort): void {
    const store = this.storage.getStore();
    if (store) {
      store.spanStack.push(span);
    } else {
      // If no store exists yet, enter a new context with this span
      this.storage.enterWith({ spanStack: [span] });
    }
  }

  /**
   * Removes the most recent span from the stack, restoring the parent
   * as the active span. Called when a span ends.
   */
  restoreParentSpan(): void {
    const store = this.storage.getStore();
    if (store && store.spanStack.length > 0) {
      store.spanStack.pop();
    }
  }

  /**
   * Resets the context entirely, clearing all spans from the stack.
   */
  clear(): void {
    const store = this.storage.getStore();
    if (store) {
      store.spanStack = [];
    }
  }

  /**
   * Executes a callback within a new async context. This is used by the
   * interceptor to establish an isolated context for each request.
   */
  run<T>(fn: () => T): T {
    return this.storage.run({ spanStack: [] }, fn);
  }
}

// Module-level singleton instance
export const contextManager = new ContextManagerImpl();
export type ContextManager = ContextManagerImpl;
