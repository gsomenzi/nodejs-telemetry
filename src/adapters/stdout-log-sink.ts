import { StructuredLog } from '../types';

/**
 * Writes structured logs as JSON lines to stdout.
 * Used as a LogHandler by LoggerService-based adapters.
 */
export class StdoutLogSink {
  handle(log: StructuredLog): void {
    try {
      const entry: Record<string, unknown> = {
        timestamp: log.timestamp,
        level: log.level,
        message: log.message,
        resource: log.resource,
      };

      if (log.context !== undefined) {
        entry.context = log.context;
      }

      if (log.correlation !== undefined) {
        entry.correlation = log.correlation;
      }

      process.stdout.write(JSON.stringify(entry) + '\n');
    } catch {
      // Never throw — swallow errors silently
    }
  }
}
