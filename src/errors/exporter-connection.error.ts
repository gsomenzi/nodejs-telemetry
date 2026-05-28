import { TelemetryError } from './telemetry.error';

export class ExporterConnectionError extends TelemetryError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = 'ExporterConnectionError';
  }
}
