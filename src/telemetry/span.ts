import { IdGenerator } from './id-generator';
import { SpanPort } from '../ports/tracer.port';
import { SpanStatus, SpanEvent } from '../types';
import { contextManager } from './context-manager';

/**
 * Concrete implementation of SpanPort.
 * Represents a unit of work within a trace with start/end timestamps,
 * attributes, events, and status.
 */
export class Span implements SpanPort {
  readonly spanId: string;
  readonly traceId: string;
  readonly name: string;

  private _startTime: string;
  private _endTime: string | null = null;
  private _status: SpanStatus = 'UNSET';
  private _attributes: Record<string, string | number | boolean> = {};
  private _events: SpanEvent[] = [];
  private _ended = false;

  constructor(name: string, traceId: string, spanId?: string) {
    this.name = name;
    this.traceId = traceId;
    this.spanId = spanId ?? IdGenerator.spanId();
    this._startTime = new Date().toISOString();
  }

  get startTime(): string {
    return this._startTime;
  }

  get endTime(): string | null {
    return this._endTime;
  }

  get status(): SpanStatus {
    return this._status;
  }

  get attributes(): Record<string, string | number | boolean> {
    return { ...this._attributes };
  }

  get events(): SpanEvent[] {
    return [...this._events];
  }

  get ended(): boolean {
    return this._ended;
  }

  setAttribute(key: string, value: string | number | boolean): void {
    if (this._ended) return;
    this._attributes[key] = value;
  }

  addEvent(name: string, attributes?: Record<string, unknown>): void {
    if (this._ended) return;
    this._events.push({
      name,
      timestamp: new Date().toISOString(),
      attributes,
    });
  }

  recordError(error: Error): void {
    if (this._ended) return;
    this.addEvent('exception', {
      'exception.type': error.name,
      'exception.message': error.message,
      'exception.stacktrace': error.stack,
    });
    this._status = 'ERROR';
  }

  setStatus(status: SpanStatus): void {
    if (this._ended) return;
    this._status = status;
  }

  /**
   * Ends the span, recording the end timestamp and restoring the parent span
   * in the ContextManager. This method is idempotent — calling it multiple
   * times after the first is a no-op.
   */
  end(): void {
    if (this._ended) return;
    this._ended = true;
    this._endTime = new Date().toISOString();
    contextManager.restoreParentSpan();
  }
}

/**
 * A no-op span implementation used when TracerService encounters errors
 * (e.g., context corruption). All methods are safe no-ops.
 */
export class NoopSpan implements SpanPort {
  readonly spanId: string = '0000000000000000';
  readonly traceId: string = '00000000000000000000000000000000';
  readonly name: string = 'noop';

  setAttribute(_key: string, _value: string | number | boolean): void {
    // no-op
  }

  addEvent(_name: string, _attributes?: Record<string, unknown>): void {
    // no-op
  }

  recordError(_error: Error): void {
    // no-op
  }

  setStatus(_status: SpanStatus): void {
    // no-op
  }

  end(): void {
    // no-op
  }
}
