import { Span, NoopSpan } from '../../src/telemetry/span';
import { contextManager } from '../../src/telemetry/context-manager';

describe('Span', () => {
  beforeEach(() => {
    contextManager.clear();
  });

  describe('constructor', () => {
    it('should create a span with the given name and traceId', () => {
      const span = new Span('test-span', 'trace-123');
      expect(span.name).toBe('test-span');
      expect(span.traceId).toBe('trace-123');
      expect(span.spanId).toBeDefined();
      expect(span.startTime).toBeDefined();
    });

    it('should use provided spanId when given', () => {
      const span = new Span('test-span', 'trace-123', 'span-456');
      expect(span.spanId).toBe('span-456');
    });

    it('should generate a unique spanId when not provided', () => {
      const span1 = new Span('span-1', 'trace-123');
      const span2 = new Span('span-2', 'trace-123');
      expect(span1.spanId).not.toBe(span2.spanId);
    });

    it('should initialize with UNSET status', () => {
      const span = new Span('test-span', 'trace-123');
      expect(span.status).toBe('UNSET');
    });

    it('should record a start timestamp on creation', () => {
      const before = new Date().toISOString();
      const span = new Span('test-span', 'trace-123');
      const after = new Date().toISOString();
      expect(span.startTime >= before).toBe(true);
      expect(span.startTime <= after).toBe(true);
    });
  });

  describe('setAttribute', () => {
    it('should store string attributes', () => {
      const span = new Span('test-span', 'trace-123');
      span.setAttribute('key', 'value');
      expect(span.attributes).toEqual({ key: 'value' });
    });

    it('should store number attributes', () => {
      const span = new Span('test-span', 'trace-123');
      span.setAttribute('count', 42);
      expect(span.attributes).toEqual({ count: 42 });
    });

    it('should store boolean attributes', () => {
      const span = new Span('test-span', 'trace-123');
      span.setAttribute('active', true);
      expect(span.attributes).toEqual({ active: true });
    });

    it('should overwrite existing attributes with the same key', () => {
      const span = new Span('test-span', 'trace-123');
      span.setAttribute('key', 'old');
      span.setAttribute('key', 'new');
      expect(span.attributes).toEqual({ key: 'new' });
    });

    it('should be a no-op after span is ended', () => {
      const span = new Span('test-span', 'trace-123');
      contextManager.setActiveSpan(span);
      span.setAttribute('before', 'yes');
      span.end();
      span.setAttribute('after', 'no');
      expect(span.attributes).toEqual({ before: 'yes' });
    });
  });

  describe('addEvent', () => {
    it('should add an event with name and timestamp', () => {
      const span = new Span('test-span', 'trace-123');
      span.addEvent('event-1');
      expect(span.events).toHaveLength(1);
      expect(span.events[0].name).toBe('event-1');
      expect(span.events[0].timestamp).toBeDefined();
    });

    it('should add an event with attributes', () => {
      const span = new Span('test-span', 'trace-123');
      span.addEvent('event-1', { detail: 'info' });
      expect(span.events[0].attributes).toEqual({ detail: 'info' });
    });

    it('should be a no-op after span is ended', () => {
      const span = new Span('test-span', 'trace-123');
      contextManager.setActiveSpan(span);
      span.end();
      span.addEvent('late-event');
      expect(span.events).toHaveLength(0);
    });
  });

  describe('recordError', () => {
    it('should add an exception event with error details', () => {
      const span = new Span('test-span', 'trace-123');
      const error = new Error('something went wrong');
      span.recordError(error);

      expect(span.events).toHaveLength(1);
      expect(span.events[0].name).toBe('exception');
      expect(span.events[0].attributes).toMatchObject({
        'exception.type': 'Error',
        'exception.message': 'something went wrong',
      });
    });

    it('should set status to ERROR', () => {
      const span = new Span('test-span', 'trace-123');
      span.recordError(new Error('fail'));
      expect(span.status).toBe('ERROR');
    });

    it('should be a no-op after span is ended', () => {
      const span = new Span('test-span', 'trace-123');
      contextManager.setActiveSpan(span);
      span.end();
      span.recordError(new Error('late error'));
      expect(span.events).toHaveLength(0);
      expect(span.status).toBe('UNSET');
    });
  });

  describe('setStatus', () => {
    it('should set status to OK', () => {
      const span = new Span('test-span', 'trace-123');
      span.setStatus('OK');
      expect(span.status).toBe('OK');
    });

    it('should set status to ERROR', () => {
      const span = new Span('test-span', 'trace-123');
      span.setStatus('ERROR');
      expect(span.status).toBe('ERROR');
    });

    it('should be a no-op after span is ended', () => {
      const span = new Span('test-span', 'trace-123');
      contextManager.setActiveSpan(span);
      span.end();
      span.setStatus('OK');
      expect(span.status).toBe('UNSET');
    });
  });

  describe('end', () => {
    it('should record end timestamp', () => {
      const span = new Span('test-span', 'trace-123');
      contextManager.setActiveSpan(span);
      span.end();
      expect(span.endTime).toBeDefined();
      expect(span.ended).toBe(true);
    });

    it('should have endTime >= startTime', () => {
      const span = new Span('test-span', 'trace-123');
      contextManager.setActiveSpan(span);
      span.end();
      expect(span.endTime! >= span.startTime).toBe(true);
    });

    it('should be idempotent — second call is a no-op', () => {
      const span = new Span('test-span', 'trace-123');
      contextManager.setActiveSpan(span);
      span.end();
      const firstEndTime = span.endTime;
      span.end();
      expect(span.endTime).toBe(firstEndTime);
    });

    it('should restore parent span in ContextManager', () => {
      const parent = new Span('parent', 'trace-123');
      contextManager.setActiveSpan(parent);

      const child = new Span('child', 'trace-123');
      contextManager.setActiveSpan(child);

      expect(contextManager.getActiveSpan()).toBe(child);
      child.end();
      expect(contextManager.getActiveSpan()).toBe(parent);
    });
  });
});

describe('NoopSpan', () => {
  it('should have default spanId and traceId', () => {
    const span = new NoopSpan();
    expect(span.spanId).toBe('0000000000000000');
    expect(span.traceId).toBe('00000000000000000000000000000000');
    expect(span.name).toBe('noop');
  });

  it('should not throw on any method call', () => {
    const span = new NoopSpan();
    expect(() => span.setAttribute('key', 'value')).not.toThrow();
    expect(() => span.addEvent('event')).not.toThrow();
    expect(() => span.recordError(new Error('test'))).not.toThrow();
    expect(() => span.setStatus('ERROR')).not.toThrow();
    expect(() => span.end()).not.toThrow();
  });
});
