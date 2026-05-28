import { SpanStatus } from '../types';

export const TRACER_PORT = 'TRACER_PORT';

export interface SpanOptions {
  attributes?: Record<string, string | number | boolean>;
  parentSpan?: SpanPort;
}

export interface SpanPort {
  readonly spanId: string;
  readonly traceId: string;
  readonly name: string;
  setAttribute(key: string, value: string | number | boolean): void;
  addEvent(name: string, attributes?: Record<string, unknown>): void;
  recordError(error: Error): void;
  setStatus(status: SpanStatus): void;
  end(): void;
}

export interface TracerPort {
  startSpan(name: string, options?: SpanOptions): SpanPort;
  getActiveSpan(): SpanPort | null;
}
