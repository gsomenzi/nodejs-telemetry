import { TracerService } from '../../src/telemetry/tracer-service';
import { Span, NoopSpan } from '../../src/telemetry/span';
import { contextManager } from '../../src/telemetry/context-manager';

describe('TracerService', () => {
  let tracer: TracerService;

  beforeEach(() => {
    tracer = new TracerService();
    contextManager.clear();
  });

  describe('startSpan', () => {
    it('should create a span with the given name', () => {
      const span = tracer.startSpan('test-operation');
      expect(span.name).toBe('test-operation');
    });

    it('should generate a unique spanId', () => {
      const span1 = tracer.startSpan('op-1');
      span1.end();
      const span2 = tracer.startSpan('op-2');
      expect(span1.spanId).not.toBe(span2.spanId);
    });

    it('should generate a new traceId for root spans (no active span)', () => {
      const span = tracer.startSpan('root-span');
      expect(span.traceId).toBeDefined();
      expect(span.traceId.length).toBeGreaterThan(0);
    });

    it('should generate unique traceIds for different root spans', () => {
      const span1 = tracer.startSpan('root-1');
      span1.end();
      contextManager.clear();
      const span2 = tracer.startSpan('root-2');
      expect(span1.traceId).not.toBe(span2.traceId);
    });

    it('should inherit traceId from active span (child span)', () => {
      const parent = tracer.startSpan('parent');
      const child = tracer.startSpan('child');
      expect(child.traceId).toBe(parent.traceId);
    });

    it('should inherit traceId from explicit parentSpan option', () => {
      const parent = tracer.startSpan('parent');
      parent.end();
      contextManager.clear();

      const child = tracer.startSpan('child', { parentSpan: parent });
      expect(child.traceId).toBe(parent.traceId);
    });

    it('should set the new span as active in ContextManager', () => {
      const span = tracer.startSpan('active-span');
      expect(contextManager.getActiveSpan()).toBe(span);
    });

    it('should apply initial attributes from options', () => {
      const span = tracer.startSpan('with-attrs', {
        attributes: { 'http.method': 'GET', 'http.status': 200 },
      });
      expect((span as Span).attributes).toEqual({
        'http.method': 'GET',
        'http.status': 200,
      });
    });

    it('should support nested spans with proper context restoration', () => {
      const parent = tracer.startSpan('parent');
      const child = tracer.startSpan('child');

      expect(contextManager.getActiveSpan()).toBe(child);
      child.end();
      expect(contextManager.getActiveSpan()).toBe(parent);
      parent.end();
      expect(contextManager.getActiveSpan()).toBeNull();
    });

    it('should never throw — returns NoopSpan on error', () => {
      // Simulate context corruption by mocking contextManager
      const originalSetActiveSpan = contextManager.setActiveSpan.bind(contextManager);
      jest.spyOn(contextManager, 'setActiveSpan').mockImplementation(() => {
        throw new Error('context corrupted');
      });

      const span = tracer.startSpan('error-span');
      expect(span).toBeInstanceOf(NoopSpan);

      // Restore
      jest.spyOn(contextManager, 'setActiveSpan').mockImplementation(originalSetActiveSpan);
    });
  });

  describe('getActiveSpan', () => {
    it('should return null when no span is active', () => {
      expect(tracer.getActiveSpan()).toBeNull();
    });

    it('should return the active span after startSpan', () => {
      const span = tracer.startSpan('active');
      expect(tracer.getActiveSpan()).toBe(span);
    });

    it('should return the most recent span when nested', () => {
      tracer.startSpan('parent');
      const child = tracer.startSpan('child');
      expect(tracer.getActiveSpan()).toBe(child);
    });

    it('should never throw — returns null on error', () => {
      jest.spyOn(contextManager, 'getActiveSpan').mockImplementation(() => {
        throw new Error('context corrupted');
      });

      expect(tracer.getActiveSpan()).toBeNull();

      jest.restoreAllMocks();
    });
  });
});
