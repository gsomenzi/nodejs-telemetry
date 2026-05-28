import { of, throwError } from 'rxjs';
import { TelemetryInterceptor } from '../../src/nestjs/telemetry.interceptor';
import { TracerPort, SpanPort } from '../../src/ports/tracer.port';
import { SpanStatus } from '../../src/types';

/**
 * Creates a mock SpanPort for testing.
 */
function createMockSpan(overrides?: Partial<SpanPort>): SpanPort & {
  setAttributeCalls: Array<{ key: string; value: string | number | boolean }>;
  recordErrorCalls: Error[];
  setStatusCalls: SpanStatus[];
  endCalled: boolean;
} {
  const setAttributeCalls: Array<{ key: string; value: string | number | boolean }> = [];
  const recordErrorCalls: Error[] = [];
  const setStatusCalls: SpanStatus[] = [];
  let endCalled = false;

  return {
    spanId: 'aabbccdd11223344aabbccdd11223344',
    traceId: 'aabbccdd11223344aabbccdd11223344',
    name: 'test-span',
    setAttributeCalls,
    recordErrorCalls,
    setStatusCalls,
    endCalled,
    setAttribute(key: string, value: string | number | boolean) {
      setAttributeCalls.push({ key, value });
    },
    addEvent(_name: string, _attributes?: Record<string, unknown>) {},
    recordError(error: Error) {
      recordErrorCalls.push(error);
    },
    setStatus(status: SpanStatus) {
      setStatusCalls.push(status);
    },
    end() {
      endCalled = true;
      // Update the reference so tests can check it
      (this as any).endCalled = true;
    },
    ...overrides,
  };
}

/**
 * Creates a mock TracerPort for testing.
 */
function createMockTracer(span: SpanPort): TracerPort {
  return {
    startSpan: jest.fn().mockReturnValue(span),
    getActiveSpan: jest.fn().mockReturnValue(null),
  };
}

/**
 * Creates a mock ExecutionContext for HTTP requests.
 */
function createMockExecutionContext(options?: {
  method?: string;
  url?: string;
  routePath?: string;
  headers?: Record<string, string | string[] | undefined>;
  statusCode?: number;
}) {
  const {
    method = 'GET',
    url = '/test',
    routePath,
    headers = {},
    statusCode = 200,
  } = options ?? {};

  const responseHeaders: Record<string, string> = {};

  const request = {
    method,
    url,
    headers,
    route: routePath ? { path: routePath } : undefined,
  };

  const response = {
    statusCode,
    setHeader: jest.fn((key: string, value: string) => {
      responseHeaders[key] = value;
    }),
  };

  const httpContext = {
    getRequest: () => request,
    getResponse: () => response,
  };

  const executionContext = {
    switchToHttp: () => httpContext,
    getType: () => 'http',
    getClass: () => ({}),
    getHandler: () => ({}),
    getArgs: () => [],
    getArgByIndex: () => ({}),
    switchToRpc: () => ({}),
    switchToWs: () => ({}),
  } as any;

  return { executionContext, request, response, responseHeaders };
}

/**
 * Creates a mock CallHandler.
 */
function createMockCallHandler(result?: any, error?: Error) {
  return {
    handle: jest.fn(() => {
      if (error) {
        return throwError(() => error);
      }
      return of(result ?? { success: true });
    }),
  };
}

describe('TelemetryInterceptor', () => {
  let interceptor: TelemetryInterceptor;
  let mockSpan: ReturnType<typeof createMockSpan>;
  let mockTracer: TracerPort;

  beforeEach(() => {
    mockSpan = createMockSpan();
    mockTracer = createMockTracer(mockSpan);
    interceptor = new TelemetryInterceptor(mockTracer);
  });

  describe('span creation', () => {
    it('should create a root span when no traceparent header is present', (done) => {
      const { executionContext } = createMockExecutionContext();
      const callHandler = createMockCallHandler();

      interceptor.intercept(executionContext, callHandler).subscribe({
        complete: () => {
          expect(mockTracer.startSpan).toHaveBeenCalledWith('GET /test');
          done();
        },
      });
    });

    it('should create a child span when traceparent header is present', (done) => {
      const traceId = 'abcdef1234567890abcdef1234567890';
      const parentSpanId = 'abcdef1234567890';
      const traceparent = `00-${traceId}-${parentSpanId}-01`;

      const { executionContext } = createMockExecutionContext({
        headers: { traceparent },
      });
      const callHandler = createMockCallHandler();

      interceptor.intercept(executionContext, callHandler).subscribe({
        complete: () => {
          // When traceparent is present, the interceptor creates a Span directly
          // (not via tracer.startSpan) with the extracted traceId
          expect(mockTracer.startSpan).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('should use route path in span name when available', (done) => {
      const { executionContext } = createMockExecutionContext({
        method: 'POST',
        url: '/users/123',
        routePath: '/users/:id',
      });
      const callHandler = createMockCallHandler();

      interceptor.intercept(executionContext, callHandler).subscribe({
        complete: () => {
          expect(mockTracer.startSpan).toHaveBeenCalledWith('POST /users/:id');
          done();
        },
      });
    });
  });

  describe('HTTP attributes', () => {
    it('should set http.method attribute on span', (done) => {
      const { executionContext } = createMockExecutionContext({ method: 'POST' });
      const callHandler = createMockCallHandler();

      interceptor.intercept(executionContext, callHandler).subscribe({
        complete: () => {
          const methodAttr = mockSpan.setAttributeCalls.find(c => c.key === 'http.method');
          expect(methodAttr).toBeDefined();
          expect(methodAttr!.value).toBe('POST');
          done();
        },
      });
    });

    it('should set http.url attribute on span', (done) => {
      const { executionContext } = createMockExecutionContext({ url: '/api/users' });
      const callHandler = createMockCallHandler();

      interceptor.intercept(executionContext, callHandler).subscribe({
        complete: () => {
          const urlAttr = mockSpan.setAttributeCalls.find(c => c.key === 'http.url');
          expect(urlAttr).toBeDefined();
          expect(urlAttr!.value).toBe('/api/users');
          done();
        },
      });
    });

    it('should set http.route attribute when route path is available', (done) => {
      const { executionContext } = createMockExecutionContext({
        routePath: '/users/:id',
      });
      const callHandler = createMockCallHandler();

      interceptor.intercept(executionContext, callHandler).subscribe({
        complete: () => {
          const routeAttr = mockSpan.setAttributeCalls.find(c => c.key === 'http.route');
          expect(routeAttr).toBeDefined();
          expect(routeAttr!.value).toBe('/users/:id');
          done();
        },
      });
    });

    it('should not set http.route when route is not available', (done) => {
      const { executionContext } = createMockExecutionContext();
      const callHandler = createMockCallHandler();

      interceptor.intercept(executionContext, callHandler).subscribe({
        complete: () => {
          const routeAttr = mockSpan.setAttributeCalls.find(c => c.key === 'http.route');
          expect(routeAttr).toBeUndefined();
          done();
        },
      });
    });
  });

  describe('successful response', () => {
    it('should record status code on span', (done) => {
      const { executionContext } = createMockExecutionContext({ statusCode: 201 });
      const callHandler = createMockCallHandler();

      interceptor.intercept(executionContext, callHandler).subscribe({
        complete: () => {
          const statusAttr = mockSpan.setAttributeCalls.find(c => c.key === 'http.status_code');
          expect(statusAttr).toBeDefined();
          expect(statusAttr!.value).toBe(201);
          done();
        },
      });
    });

    it('should record duration on span', (done) => {
      const { executionContext } = createMockExecutionContext();
      const callHandler = createMockCallHandler();

      interceptor.intercept(executionContext, callHandler).subscribe({
        complete: () => {
          const durationAttr = mockSpan.setAttributeCalls.find(c => c.key === 'http.duration_ms');
          expect(durationAttr).toBeDefined();
          expect(typeof durationAttr!.value).toBe('number');
          expect(durationAttr!.value as number).toBeGreaterThanOrEqual(0);
          done();
        },
      });
    });

    it('should set span status to OK on success', (done) => {
      const { executionContext } = createMockExecutionContext();
      const callHandler = createMockCallHandler();

      interceptor.intercept(executionContext, callHandler).subscribe({
        complete: () => {
          expect(mockSpan.setStatusCalls).toContain('OK');
          done();
        },
      });
    });

    it('should end the span on success', (done) => {
      const { executionContext } = createMockExecutionContext();
      const callHandler = createMockCallHandler();

      interceptor.intercept(executionContext, callHandler).subscribe({
        complete: () => {
          expect(mockSpan.endCalled).toBe(true);
          done();
        },
      });
    });

    it('should inject propagation headers on response', (done) => {
      const { executionContext, response } = createMockExecutionContext();
      const callHandler = createMockCallHandler();

      interceptor.intercept(executionContext, callHandler).subscribe({
        complete: () => {
          expect(response.setHeader).toHaveBeenCalledWith(
            'traceparent',
            expect.stringMatching(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/),
          );
          done();
        },
      });
    });
  });

  describe('error response', () => {
    it('should record error on span when handler throws', (done) => {
      const { executionContext } = createMockExecutionContext();
      const error = new Error('Something went wrong');
      const callHandler = createMockCallHandler(undefined, error);

      interceptor.intercept(executionContext, callHandler).subscribe({
        error: () => {
          expect(mockSpan.recordErrorCalls).toHaveLength(1);
          expect(mockSpan.recordErrorCalls[0]).toBe(error);
          done();
        },
      });
    });

    it('should set span status to ERROR when handler throws', (done) => {
      const { executionContext } = createMockExecutionContext();
      const error = new Error('Something went wrong');
      const callHandler = createMockCallHandler(undefined, error);

      interceptor.intercept(executionContext, callHandler).subscribe({
        error: () => {
          expect(mockSpan.setStatusCalls).toContain('ERROR');
          done();
        },
      });
    });

    it('should record error status code from error.status', (done) => {
      const { executionContext } = createMockExecutionContext();
      const error = Object.assign(new Error('Not Found'), { status: 404 });
      const callHandler = createMockCallHandler(undefined, error);

      interceptor.intercept(executionContext, callHandler).subscribe({
        error: () => {
          const statusAttr = mockSpan.setAttributeCalls.find(c => c.key === 'http.status_code');
          expect(statusAttr).toBeDefined();
          expect(statusAttr!.value).toBe(404);
          done();
        },
      });
    });

    it('should default to 500 status code when error has no status', (done) => {
      const { executionContext } = createMockExecutionContext();
      const error = new Error('Internal error');
      const callHandler = createMockCallHandler(undefined, error);

      interceptor.intercept(executionContext, callHandler).subscribe({
        error: () => {
          const statusAttr = mockSpan.setAttributeCalls.find(c => c.key === 'http.status_code');
          expect(statusAttr).toBeDefined();
          expect(statusAttr!.value).toBe(500);
          done();
        },
      });
    });

    it('should end the span on error', (done) => {
      const { executionContext } = createMockExecutionContext();
      const error = new Error('Something went wrong');
      const callHandler = createMockCallHandler(undefined, error);

      interceptor.intercept(executionContext, callHandler).subscribe({
        error: () => {
          expect(mockSpan.endCalled).toBe(true);
          done();
        },
      });
    });

    it('should re-throw the original error', (done) => {
      const { executionContext } = createMockExecutionContext();
      const error = new Error('Original error');
      const callHandler = createMockCallHandler(undefined, error);

      interceptor.intercept(executionContext, callHandler).subscribe({
        error: (err) => {
          expect(err).toBe(error);
          done();
        },
      });
    });

    it('should inject propagation headers even on error', (done) => {
      const { executionContext, response } = createMockExecutionContext();
      const error = new Error('Something went wrong');
      const callHandler = createMockCallHandler(undefined, error);

      interceptor.intercept(executionContext, callHandler).subscribe({
        error: () => {
          expect(response.setHeader).toHaveBeenCalledWith(
            'traceparent',
            expect.stringMatching(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/),
          );
          done();
        },
      });
    });
  });

  describe('context propagation', () => {
    it('should extract traceparent and create child span with same traceId', (done) => {
      const traceId = 'abcdef1234567890abcdef1234567890';
      const parentSpanId = 'abcdef1234567890';
      const traceparent = `00-${traceId}-${parentSpanId}-01`;

      const { executionContext, response } = createMockExecutionContext({
        headers: { traceparent },
      });
      const callHandler = createMockCallHandler();

      interceptor.intercept(executionContext, callHandler).subscribe({
        complete: () => {
          // The response should have a traceparent header with the same traceId
          const setHeaderCall = response.setHeader.mock.calls.find(
            (call: any[]) => call[0] === 'traceparent',
          );
          expect(setHeaderCall).toBeDefined();
          const responseTraceparent = setHeaderCall![1] as string;
          expect(responseTraceparent).toContain(traceId);
          done();
        },
      });
    });

    it('should handle invalid traceparent gracefully and create root span', (done) => {
      const { executionContext } = createMockExecutionContext({
        headers: { traceparent: 'invalid-traceparent' },
      });
      const callHandler = createMockCallHandler();

      interceptor.intercept(executionContext, callHandler).subscribe({
        complete: () => {
          // Should fall back to creating a root span via tracer
          expect(mockTracer.startSpan).toHaveBeenCalled();
          done();
        },
      });
    });
  });
});
