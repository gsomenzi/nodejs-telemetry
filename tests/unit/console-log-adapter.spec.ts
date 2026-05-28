import { ConsoleLogAdapter } from '../../src/adapters/console-log-adapter';

describe('ConsoleLogAdapter', () => {
  let adapter: ConsoleLogAdapter;
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    adapter = new ConsoleLogAdapter();
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('should output structured JSON with timestamp, level, and message', () => {
    adapter.info('Hello world');

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const output = (stdoutSpy.mock.calls[0][0] as string).trim();
    const parsed = JSON.parse(output);

    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('Hello world');
    expect(parsed.timestamp).toBeDefined();
    // Verify ISO 8601 format
    expect(new Date(parsed.timestamp).toISOString()).toBe(parsed.timestamp);
  });

  it('should include context when provided', () => {
    adapter.info('Order created', { orderId: '123', amount: 99.9 });

    const output = (stdoutSpy.mock.calls[0][0] as string).trim();
    const parsed = JSON.parse(output);

    expect(parsed.context).toEqual({ orderId: '123', amount: 99.9 });
  });

  it('should not include context key when context is undefined', () => {
    adapter.info('Simple message');

    const output = (stdoutSpy.mock.calls[0][0] as string).trim();
    const parsed = JSON.parse(output);

    expect(parsed).not.toHaveProperty('context');
  });

  it.each(['debug', 'info', 'warn', 'error', 'fatal'] as const)(
    'should output correct level for %s',
    (level) => {
      adapter[level]('test message');

      const output = (stdoutSpy.mock.calls[0][0] as string).trim();
      const parsed = JSON.parse(output);

      expect(parsed.level).toBe(level);
    },
  );

  it('should append newline to each log entry', () => {
    adapter.info('test');

    const output = stdoutSpy.mock.calls[0][0] as string;
    expect(output.endsWith('\n')).toBe(true);
  });

  it('should never throw even if stdout.write fails', () => {
    stdoutSpy.mockImplementation(() => {
      throw new Error('stdout broken');
    });

    expect(() => adapter.info('should not throw')).not.toThrow();
    expect(() => adapter.error('should not throw')).not.toThrow();
  });

  it('should handle context with circular references gracefully', () => {
    const circular: Record<string, unknown> = { key: 'value' };
    circular.self = circular;

    // JSON.stringify will throw on circular references, but the adapter should not throw
    expect(() => adapter.info('circular', circular)).not.toThrow();
  });
});
