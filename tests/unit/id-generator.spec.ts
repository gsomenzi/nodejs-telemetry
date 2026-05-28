import { IdGenerator } from '../../src/telemetry/id-generator';

describe('IdGenerator', () => {
  describe('generate', () => {
    it('should generate a hex string of the specified length', () => {
      const result = IdGenerator.generate(32);
      expect(result).toHaveLength(32);
      expect(result).toMatch(/^[0-9a-f]{32}$/);
    });

    it('should generate different values on each call', () => {
      const a = IdGenerator.generate(16);
      const b = IdGenerator.generate(16);
      expect(a).not.toBe(b);
    });

    it('should throw for odd hexLength', () => {
      expect(() => IdGenerator.generate(15)).toThrow(
        'hexLength must be a positive even number, got 15',
      );
    });

    it('should throw for zero hexLength', () => {
      expect(() => IdGenerator.generate(0)).toThrow(
        'hexLength must be a positive even number, got 0',
      );
    });

    it('should throw for negative hexLength', () => {
      expect(() => IdGenerator.generate(-2)).toThrow(
        'hexLength must be a positive even number, got -2',
      );
    });
  });

  describe('traceId', () => {
    it('should generate a 32-character hex string', () => {
      const traceId = IdGenerator.traceId();
      expect(traceId).toHaveLength(32);
      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe('spanId', () => {
    it('should generate a 16-character hex string', () => {
      const spanId = IdGenerator.spanId();
      expect(spanId).toHaveLength(16);
      expect(spanId).toMatch(/^[0-9a-f]{16}$/);
    });
  });
});
