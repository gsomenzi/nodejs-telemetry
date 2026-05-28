import { TelemetryError } from './telemetry.error';

export class SpanContextError extends TelemetryError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = 'SpanContextError';
  }
}
