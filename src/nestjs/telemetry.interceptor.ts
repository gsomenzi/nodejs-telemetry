import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap, catchError } from 'rxjs';
import { throwError } from 'rxjs';
import { TracerPort, SpanPort } from '../ports/tracer.port';
import { ContextPropagator } from '../adapters/context-propagator';
import { contextManager } from '../telemetry/context-manager';
import { Span } from '../telemetry/span';

/**
 * TelemetryInterceptor automatically creates spans for incoming HTTP requests
 * and handles W3C Trace Context propagation (extract on request, inject on response).
 *
 * It:
 * 1. Extracts traceparent/tracestate from incoming request headers
 * 2. Creates a child span (if context extracted) or root span
 * 3. Sets span as active in ContextManager for the request lifecycle
 * 4. Sets HTTP attributes on the span (method, url, route)
 * 5. On response: records status code, injects propagation headers, ends span
 * 6. On error: records error on span, sets status to ERROR, ends span
 *
 * Usage with NestJS module:
 * ```typescript
 * // The TelemetryModule registers this interceptor with the TRACER_PORT provider.
 * // To use as a global interceptor:
 * {
 *   provide: APP_INTERCEPTOR,
 *   useFactory: (tracer: TracerPort) => new TelemetryInterceptor(tracer),
 *   inject: [TRACER_PORT],
 * }
 * ```
 */
@Injectable()
export class TelemetryInterceptor implements NestInterceptor {
  private readonly propagator = new ContextPropagator();

  constructor(private readonly tracer: TracerPort) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest();
    const response = httpContext.getResponse();

    const headers: Record<string, string | string[] | undefined> = request.headers ?? {};

    // 1. Extract traceparent/tracestate from incoming request headers
    const extractedContext = this.propagator.extract(headers);

    // 2. Create span — use extracted traceId if available, otherwise generate new
    const spanName = `${request.method} ${request.route?.path ?? request.url}`;

    return new Observable((subscriber) => {
      contextManager.run(() => {
        let span: SpanPort;

        if (extractedContext) {
          // Create a child span linked to the extracted trace
          const childSpan = new Span(spanName, extractedContext.traceId);
          contextManager.setActiveSpan(childSpan);
          span = childSpan;
        } else {
          // Create a root span via the tracer (generates new traceId)
          span = this.tracer.startSpan(spanName);
        }

        // 3. Set HTTP attributes on the span
        span.setAttribute('http.method', request.method ?? 'UNKNOWN');
        span.setAttribute('http.url', request.url ?? '/');
        if (request.route?.path) {
          span.setAttribute('http.route', request.route.path);
        }

        const startTime = Date.now();

        // Proceed with the request handler
        next.handle().pipe(
          tap(() => {
            // 4. On success: record duration and status code
            const duration = Date.now() - startTime;
            span.setAttribute('http.status_code', response.statusCode ?? 200);
            span.setAttribute('http.duration_ms', duration);
            span.setStatus('OK');

            // 5. Inject propagation headers on outgoing response
            this.injectResponseHeaders(span, response);

            span.end();
          }),
          catchError((error: Error) => {
            // 6. On error: record error on span, set status to ERROR
            const duration = Date.now() - startTime;
            span.setAttribute('http.duration_ms', duration);

            const statusCode = (error as any).status ?? (error as any).statusCode ?? 500;
            span.setAttribute('http.status_code', statusCode);

            span.recordError(error);
            span.setStatus('ERROR');

            // Inject propagation headers even on error responses
            this.injectResponseHeaders(span, response);

            span.end();

            return throwError(() => error);
          }),
        ).subscribe(subscriber);
      });
    });
  }

  /**
   * Injects traceparent/tracestate headers into the outgoing response.
   */
  private injectResponseHeaders(span: SpanPort, response: any): void {
    try {
      const correlationContext = {
        traceId: span.traceId,
        spanId: span.spanId,
      };

      const propagationHeaders = this.propagator.inject(correlationContext);

      for (const [key, value] of Object.entries(propagationHeaders)) {
        if (response.setHeader) {
          response.setHeader(key, value);
        } else if (response.set) {
          response.set(key, value);
        }
      }
    } catch {
      // Telemetry should never crash the application
    }
  }
}
