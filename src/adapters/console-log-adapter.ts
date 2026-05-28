import { LoggerPort } from '../ports/logger.port';
import { LogLevel } from '../types';

/**
 * ConsoleLogAdapter implements LoggerPort for development/testing.
 * Outputs structured JSON to stdout via process.stdout.write.
 * Methods never throw — errors are swallowed silently.
 */
export class ConsoleLogAdapter implements LoggerPort {
  debug(message: string, context?: Record<string, unknown>): void {
    this.emit('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.emit('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.emit('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.emit('error', message, context);
  }

  fatal(message: string, context?: Record<string, unknown>): void {
    this.emit('fatal', message, context);
  }

  private emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    try {
      const entry: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        level,
        message,
      };

      if (context !== undefined) {
        entry.context = context;
      }

      process.stdout.write(JSON.stringify(entry) + '\n');
    } catch {
      // Never throw — swallow errors silently
    }
  }
}
