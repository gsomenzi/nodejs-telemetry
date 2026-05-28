import { ContextPropagator } from '../../src/adapters/context-propagator';
import { CorrelationContext } from '../../src/types';

describe('ContextPropagator', () => {
  let propagator: ContextPropagator;

  beforeEach(() => {
    propagator = new ContextPropagator();
  });

  describe('extract', () => {
    it('should extract a valid traceparent header into CorrelationContext', () => {
      const headers = {
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      };

      const result = propagator.extract(headers);

      expect(result).toEqual({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        traceFlags: 1,
      });
    });

    it('should extract tracestate header when present', () => {
      const headers = {
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        tracestate: 'congo=t61rcWkgMzE,rojo=00f067aa0ba902b7',
      };

      const result = propagator.extract(headers);

      expect(result).toEqual({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        traceFlags: 1,
        traceState: 'congo=t61rcWkgMzE,rojo=00f067aa0ba902b7',
      });
    });

    it('should return null when traceparent header is missing', () => {
      const headers = {};
      const result = propagator.extract(headers);
      expect(result).toBeNull();
    });

    it('should return null when traceparent header is undefined', () => {
      const headers = { traceparent: undefined };
      const result = propagator.extract(headers);
      expect(result).toBeNull();
    });

    it('should return null for invalid traceparent format', () => {
      const headers = { traceparent: 'invalid-header-value' };
      const result = propagator.extract(headers);
      expect(result).toBeNull();
    });

    it('should return null when trace-id is all zeros', () => {
      const headers = {
        traceparent: '00-00000000000000000000000000000000-00f067aa0ba902b7-01',
      };
      const result = propagator.extract(headers);
      expect(result).toBeNull();
    });

    it('should return null when parent-id is all zeros', () => {
      const headers = {
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01',
      };
      const result = propagator.extract(headers);
      expect(result).toBeNull();
    });

    it('should handle string array header values (take first element)', () => {
      const headers = {
        traceparent: [
          '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
          '00-aaaabbbbccccddddeeeeffffaaaabbbb-1122334455667788-00',
        ],
      };

      const result = propagator.extract(headers);

      expect(result).toEqual({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        traceFlags: 1,
      });
    });

    it('should return null for empty string array', () => {
      const headers = { traceparent: [] as string[] };
      const result = propagator.extract(headers);
      expect(result).toBeNull();
    });

    it('should parse trace-flags correctly (e.g., 00 = not sampled)', () => {
      const headers = {
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00',
      };

      const result = propagator.extract(headers);

      expect(result).toEqual({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        traceFlags: 0,
      });
    });

    it('should reject traceparent with uppercase hex characters', () => {
      const headers = {
        traceparent: '00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01',
      };
      const result = propagator.extract(headers);
      expect(result).toBeNull();
    });
  });

  describe('inject', () => {
    it('should serialize CorrelationContext into traceparent header', () => {
      const context: CorrelationContext = {
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        traceFlags: 1,
      };

      const headers = propagator.inject(context);

      expect(headers).toEqual({
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      });
    });

    it('should include tracestate header when traceState is present', () => {
      const context: CorrelationContext = {
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        traceFlags: 1,
        traceState: 'congo=t61rcWkgMzE',
      };

      const headers = propagator.inject(context);

      expect(headers).toEqual({
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        tracestate: 'congo=t61rcWkgMzE',
      });
    });

    it('should default traceFlags to 01 (sampled) when not provided', () => {
      const context: CorrelationContext = {
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
      };

      const headers = propagator.inject(context);

      expect(headers.traceparent).toBe(
        '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      );
    });

    it('should strip hyphens from UUID-format traceId', () => {
      const context: CorrelationContext = {
        traceId: '4bf92f35-77b3-4da6-a3ce-929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        traceFlags: 1,
      };

      const headers = propagator.inject(context);

      expect(headers.traceparent).toBe(
        '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      );
    });

    it('should strip hyphens from UUID-format spanId and take first 16 hex chars', () => {
      const context: CorrelationContext = {
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa-0ba9-02b7-abcd-ef1234567890',
        traceFlags: 1,
      };

      const headers = propagator.inject(context);

      // UUID without hyphens: 00f067aa0ba902b7abcdef1234567890 → first 16: 00f067aa0ba902b7
      expect(headers.traceparent).toBe(
        '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      );
    });

    it('should handle traceFlags value of 0 (not sampled)', () => {
      const context: CorrelationContext = {
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        traceFlags: 0,
      };

      const headers = propagator.inject(context);

      expect(headers.traceparent).toBe(
        '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00',
      );
    });
  });

  describe('round-trip', () => {
    it('should produce equivalent context after inject then extract', () => {
      const original: CorrelationContext = {
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        traceFlags: 1,
      };

      const headers = propagator.inject(original);
      const extracted = propagator.extract(headers);

      expect(extracted).toEqual(original);
    });

    it('should preserve traceState through round-trip', () => {
      const original: CorrelationContext = {
        traceId: 'abcdef1234567890abcdef1234567890',
        spanId: '1234567890abcdef',
        traceFlags: 1,
        traceState: 'vendor1=value1,vendor2=value2',
      };

      const headers = propagator.inject(original);
      const extracted = propagator.extract(headers);

      expect(extracted).toEqual(original);
    });
  });
});
