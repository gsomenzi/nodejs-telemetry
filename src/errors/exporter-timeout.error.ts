import { TelemetryError } from './telemetry.error';

export class ExporterTimeoutError extends TelemetryError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = 'ExporterTimeoutError';
  }
}
