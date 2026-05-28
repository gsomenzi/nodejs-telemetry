import { randomBytes } from 'node:crypto';

/**
 * Generates OTLP-compliant hex IDs for traces and spans.
 *
 * The OpenTelemetry specification requires:
 * - traceId: 32 hex characters (16 bytes)
 * - spanId: 16 hex characters (8 bytes)
 *
 * This service generates cryptographically random hex strings
 * of the requested length (in hex characters).
 *
 * @see https://opentelemetry.io/docs/specs/otel/trace/api/#spancontext
 */
export class IdGenerator {
  /**
   * Generates a random hex string of the specified length.
   *
   * @param hexLength - The desired length in hex characters (each byte = 2 hex chars).
   *                    Must be a positive even number.
   * @returns A lowercase hex string of exactly `hexLength` characters.
   *
   * @example
   * IdGenerator.generate(32) // → "4bf92f3577b34da6a3ce929d0e0e4736" (traceId)
   * IdGenerator.generate(16) // → "00f067aa0ba902b7" (spanId)
   */
  static generate(hexLength: number): string {
    if (hexLength <= 0 || hexLength % 2 !== 0) {
      throw new Error(
        `hexLength must be a positive even number, got ${hexLength}`,
      );
    }
    const byteCount = hexLength / 2;
    return randomBytes(byteCount).toString('hex');
  }

  /**
   * Generates a valid OTLP traceId (32 hex characters / 16 bytes).
   */
  static traceId(): string {
    return IdGenerator.generate(32);
  }

  /**
   * Generates a valid OTLP spanId (16 hex characters / 8 bytes).
   */
  static spanId(): string {
    return IdGenerator.generate(16);
  }
}
