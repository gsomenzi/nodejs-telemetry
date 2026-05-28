import { NoopAdapter } from '../../src/adapters/noop-adapter';
import { NoopSpan } from '../../src/telemetry/span';

describe('NoopAdapter', () => {
  let adapter: NoopAdapter;

  beforeEach(() => {
    adapter = new NoopAdapter();
  });

  describe('LoggerPort methods', () => {
    it('should not throw on debug()', () => {
      expect(() => adapter.debug('test message')).not.toThrow();
      expect(() => adapter.debug('test', { key: 'value' })).not.toThrow();
    });

    it('should not throw on info()', () => {
      expect(() => adapter.info('test message')).not.toThrow();
      expect(() => adapter.info('test', { key: 'value' })).not.toThrow();
    });

    it('should not throw on warn()', () => {
      expect(() => adapter.warn('test message')).not.toThrow();
      expect(() => adapter.warn('test', { key: 'value' })).not.toThrow();
    });

    it('should not throw on error()', () => {
      expect(() => adapter.error('test message')).not.toThrow();
      expect(() => adapter.error('test', { key: 'value' })).not.toThrow();
    });

    it('should not throw on fatal()', () => {
      expect(() => adapter.fatal('test message')).not.toThrow();
      expect(() => adapter.fatal('test', { key: 'value' })).not.toThrow();
    });
  });

  describe('TracerPort methods', () => {
    it('should return a NoopSpan from startSpan()', () => {
      const span = adapter.startSpan('test-span');
      expect(span).toBeInstanceOf(NoopSpan);
    });

    it('should return a NoopSpan with options', () => {
      const span = adapter.startSpan('test-span', { attributes: { key: 'value' } });
      expect(span).toBeInstanceOf(NoopSpan);
    });

    it('should return null from getActiveSpan()', () => {
      expect(adapter.getActiveSpan()).toBeNull();
    });
  });

  describe('MetricsPort methods', () => {
    it('should not throw on incrementCounter()', () => {
      expect(() => adapter.incrementCounter('counter')).not.toThrow();
      expect(() => adapter.incrementCounter('counter', 5)).not.toThrow();
      expect(() => adapter.incrementCounter('counter', 1, { region: 'us' })).not.toThrow();
    });

    it('should not throw on recordHistogram()', () => {
      expect(() => adapter.recordHistogram('histogram', 100)).not.toThrow();
      expect(() => adapter.recordHistogram('histogram', 100, { unit: 'ms' })).not.toThrow();
    });

    it('should not throw on recordGauge()', () => {
      expect(() => adapter.recordGauge('gauge', 42)).not.toThrow();
      expect(() => adapter.recordGauge('gauge', 42, { host: 'server-1' })).not.toThrow();
    });
  });

  describe('interface compliance', () => {
    it('should implement LoggerPort, TracerPort, and MetricsPort', () => {
      // Verify all expected methods exist
      expect(typeof adapter.debug).toBe('function');
      expect(typeof adapter.info).toBe('function');
      expect(typeof adapter.warn).toBe('function');
      expect(typeof adapter.error).toBe('function');
      expect(typeof adapter.fatal).toBe('function');
      expect(typeof adapter.startSpan).toBe('function');
      expect(typeof adapter.getActiveSpan).toBe('function');
      expect(typeof adapter.incrementCounter).toBe('function');
      expect(typeof adapter.recordHistogram).toBe('function');
      expect(typeof adapter.recordGauge).toBe('function');
    });
  });
});
