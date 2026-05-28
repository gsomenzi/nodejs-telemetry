import { TelemetryError } from './telemetry.error';

export class InvalidConfigurationError extends TelemetryError {
  readonly field: string;
  readonly reason: string;

  constructor(message: string, field: string, reason: string, cause?: Error) {
    super(message, cause);
    this.name = 'InvalidConfigurationError';
    this.field = field;
    this.reason = reason;
  }
}
