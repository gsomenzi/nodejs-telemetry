export class TelemetryError extends Error {
  readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'TelemetryError';
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
