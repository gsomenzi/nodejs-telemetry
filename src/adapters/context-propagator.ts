import { ContextPropagatorPort } from '../ports/context-propagator.port';
import { CorrelationContext } from '../types';

/**
 * W3C Trace Context traceparent format:
 * {version}-{trace-id}-{parent-id}-{trace-flags}
 * - version: 2 hex chars (currently "00")
 * - trace-id: 32 lowercase hex chars
 * - parent-id: 16 lowercase hex chars
 * - trace-flags: 2 hex chars (e.g., "01" for sampled)
 */
const TRACEPARENT_REGEX = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const TRACEPARENT_HEADER = 'traceparent';
const TRACESTATE_HEADER = 'tracestate';
const W3C_VERSION = '00';
const DEFAULT_TRACE_FLAGS = 0x01; // sampled

/**
 * ContextPropagator implements ContextPropagatorPort following the W3C Trace Context specification.
 *
 * - extract: parses traceparent/tracestate headers into a CorrelationContext
 * - inject: serializes a CorrelationContext into traceparent/tracestate headers
 *
 * Internal IDs use UUID format (with hyphens). The propagator handles conversion:
 * - inject: strips hyphens from traceId (→ 32 hex), strips hyphens from spanId and takes first 16 hex chars
 * - extract: stores the raw 32 hex trace-id and 16 hex parent-id as-is (no hyphens)
 */
export class ContextPropagator implements ContextPropagatorPort {
  extract(headers: Record<string, string | string[] | undefined>): CorrelationContext | null {
    const traceparentValue = this.getHeaderValue(headers, TRACEPARENT_HEADER);
    if (!traceparentValue) {
      return null;
    }

    const match = traceparentValue.match(TRACEPARENT_REGEX);
    if (!match) {
      return null;
    }

    const [, , traceId, spanId, traceFlagsHex] = match;
    const traceFlags = parseInt(traceFlagsHex, 16);

    // Validate that trace-id and parent-id are not all zeros
    if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) {
      return null;
    }

    const context: CorrelationContext = {
      traceId,
      spanId,
      traceFlags,
    };

    const tracestateValue = this.getHeaderValue(headers, TRACESTATE_HEADER);
    if (tracestateValue) {
      context.traceState = tracestateValue;
    }

    return context;
  }

  inject(context: CorrelationContext): Record<string, string> {
    const traceId = this.normalizeTraceId(context.traceId);
    const spanId = this.normalizeSpanId(context.spanId);
    const traceFlags = context.traceFlags ?? DEFAULT_TRACE_FLAGS;
    const traceFlagsHex = traceFlags.toString(16).padStart(2, '0');

    const headers: Record<string, string> = {
      [TRACEPARENT_HEADER]: `${W3C_VERSION}-${traceId}-${spanId}-${traceFlagsHex}`,
    };

    if (context.traceState) {
      headers[TRACESTATE_HEADER] = context.traceState;
    }

    return headers;
  }

  /**
   * Extracts a single string value from a header that may be string, string[], or undefined.
   * Takes the first element if the value is an array.
   */
  private getHeaderValue(
    headers: Record<string, string | string[] | undefined>,
    key: string,
  ): string | null {
    const value = headers[key];
    if (value === undefined) {
      return null;
    }
    if (Array.isArray(value)) {
      return value.length > 0 ? value[0] : null;
    }
    return value;
  }

  /**
   * Normalizes a traceId to 32 lowercase hex chars.
   * Strips hyphens if the ID is in UUID format.
   */
  private normalizeTraceId(traceId: string): string {
    const hex = traceId.replace(/-/g, '').toLowerCase();
    // Ensure exactly 32 hex chars, pad with leading zeros if needed
    return hex.padStart(32, '0').slice(0, 32);
  }

  /**
   * Normalizes a spanId to 16 lowercase hex chars.
   * Strips hyphens if the ID is in UUID format and takes the first 16 hex chars.
   */
  private normalizeSpanId(spanId: string): string {
    const hex = spanId.replace(/-/g, '').toLowerCase();
    // Take first 16 hex chars
    return hex.padStart(16, '0').slice(0, 16);
  }
}
