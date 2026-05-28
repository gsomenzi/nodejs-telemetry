import { contextManager } from '../../src/telemetry/context-manager';
import { SpanPort } from '../../src/ports/tracer.port';
import { SpanStatus } from '../../src/types';

function createMockSpan(overrides: Partial<SpanPort> = {}): SpanPort {
  return {
    spanId: overrides.spanId ?? 'span-1',
    traceId: overrides.traceId ?? 'trace-1',
    name: overrides.name ?? 'test-span',
    setAttribute: jest.fn(),
    addEvent: jest.fn(),
    recordError: jest.fn(),
    setStatus: jest.fn(),
    end: jest.fn(),
  };
}

describe('ContextManager', () => {
  beforeEach(() => {
    contextManager.clear();
  });

  describe('getActiveSpan', () => {
    it('returns null when no span is active', () => {
      contextManager.run(() => {
        expect(contextManager.getActiveSpan()).toBeNull();
      });
    });

    it('returns the active span after setActiveSpan', () => {
      contextManager.run(() => {
        const span = createMockSpan({ spanId: 'active-span' });
        contextManager.setActiveSpan(span);
        expect(contextManager.getActiveSpan()).toBe(span);
      });
    });
  });

  describe('getCorrelationContext', () => {
    it('returns null when no span is active', () => {
      contextManager.run(() => {
        expect(contextManager.getCorrelationContext()).toBeNull();
      });
    });

    it('returns traceId and spanId from the active span', () => {
      contextManager.run(() => {
        const span = createMockSpan({ traceId: 'trace-abc', spanId: 'span-xyz' });
        contextManager.setActiveSpan(span);

        const ctx = contextManager.getCorrelationContext();
        expect(ctx).toEqual({
          traceId: 'trace-abc',
          spanId: 'span-xyz',
        });
      });
    });
  });

  describe('span stack (nested spans)', () => {
    it('supports nested spans with stack behavior', () => {
      contextManager.run(() => {
        const parent = createMockSpan({ spanId: 'parent', traceId: 'trace-1' });
        const child = createMockSpan({ spanId: 'child', traceId: 'trace-1' });

        contextManager.setActiveSpan(parent);
        expect(contextManager.getActiveSpan()).toBe(parent);

        contextManager.setActiveSpan(child);
        expect(contextManager.getActiveSpan()).toBe(child);

        // Restore parent when child ends
        contextManager.restoreParentSpan();
        expect(contextManager.getActiveSpan()).toBe(parent);

        // Restore to empty when parent ends
        contextManager.restoreParentSpan();
        expect(contextManager.getActiveSpan()).toBeNull();
      });
    });

    it('restoreParentSpan is a no-op when stack is empty', () => {
      contextManager.run(() => {
        contextManager.restoreParentSpan();
        expect(contextManager.getActiveSpan()).toBeNull();
      });
    });
  });

  describe('clear', () => {
    it('resets the context entirely', () => {
      contextManager.run(() => {
        const span = createMockSpan();
        contextManager.setActiveSpan(span);
        expect(contextManager.getActiveSpan()).toBe(span);

        contextManager.clear();
        expect(contextManager.getActiveSpan()).toBeNull();
        expect(contextManager.getCorrelationContext()).toBeNull();
      });
    });
  });

  describe('async propagation', () => {
    it('propagates context across await boundaries', async () => {
      await contextManager.run(async () => {
        const span = createMockSpan({ spanId: 'async-span' });
        contextManager.setActiveSpan(span);

        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(contextManager.getActiveSpan()).toBe(span);
        expect(contextManager.getCorrelationContext()?.spanId).toBe('async-span');
      });
    });

    it('propagates context across setTimeout', async () => {
      await contextManager.run(async () => {
        const span = createMockSpan({ spanId: 'timer-span' });
        contextManager.setActiveSpan(span);

        const result = await new Promise<SpanPort | null>((resolve) => {
          setTimeout(() => {
            resolve(contextManager.getActiveSpan());
          }, 10);
        });

        expect(result).toBe(span);
      });
    });

    it('propagates context across setImmediate', async () => {
      await contextManager.run(async () => {
        const span = createMockSpan({ spanId: 'immediate-span' });
        contextManager.setActiveSpan(span);

        const result = await new Promise<SpanPort | null>((resolve) => {
          setImmediate(() => {
            resolve(contextManager.getActiveSpan());
          });
        });

        expect(result).toBe(span);
      });
    });

    it('isolates context between separate run calls', () => {
      const span1 = createMockSpan({ spanId: 'span-1' });
      const span2 = createMockSpan({ spanId: 'span-2' });

      contextManager.run(() => {
        contextManager.setActiveSpan(span1);
        expect(contextManager.getActiveSpan()).toBe(span1);
      });

      contextManager.run(() => {
        contextManager.setActiveSpan(span2);
        expect(contextManager.getActiveSpan()).toBe(span2);
      });
    });
  });

  describe('run', () => {
    it('executes callback within a new async context', () => {
      const result = contextManager.run(() => {
        return 'hello';
      });
      expect(result).toBe('hello');
    });

    it('provides an isolated context for each run call', () => {
      contextManager.run(() => {
        const span = createMockSpan({ spanId: 'outer' });
        contextManager.setActiveSpan(span);

        contextManager.run(() => {
          // Inner run has its own empty context
          expect(contextManager.getActiveSpan()).toBeNull();
        });

        // Outer context is preserved
        expect(contextManager.getActiveSpan()).toBe(span);
      });
    });
  });

  describe('setActiveSpan without prior context', () => {
    it('creates a new context when no store exists', () => {
      // This tests the enterWith path — calling setActiveSpan outside of run()
      const span = createMockSpan({ spanId: 'no-context-span' });
      contextManager.setActiveSpan(span);
      expect(contextManager.getActiveSpan()).toBe(span);

      // Clean up
      contextManager.clear();
    });
  });
});
