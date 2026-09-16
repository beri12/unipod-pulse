import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { tap } from 'rxjs/operators';
import { requestContext, StructuredLogger, type RequestContext } from '../logger';

/**
 * Assigns a request id, makes it available to every downstream log line, and
 * records one structured access-log entry per request.
 *
 * Query strings and bodies are deliberately not logged: this application
 * handles private community content.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  constructor(private readonly logger: StructuredLogger) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: { id?: string } }>();
    const response = http.getResponse<Response>();

    const headerId = request.headers['x-request-id'];
    const requestId =
      (typeof headerId === 'string' && headerId.length <= 64 ? headerId : undefined) ?? randomUUID();

    // Also stamped on the request itself: exception filters run outside the
    // interceptor chain, so they cannot read the async-local store.
    (request as { requestId?: string }).requestId = requestId;

    const store: RequestContext = {
      requestId,
      route: `${request.method} ${request.route?.path ?? request.path}`,
    };
    response.setHeader('x-request-id', requestId);

    const startedAt = process.hrtime.bigint();

    return requestContext.run(store, () =>
      next.handle().pipe(
        tap({
          next: () => {
            store.userId = request.user?.id;
            this.write(request, response.statusCode, startedAt);
          },
          error: (error: { status?: number }) => {
            store.userId = request.user?.id;
            this.write(request, error?.status ?? 500, startedAt);
          },
        }),
      ),
    );
  }

  private write(request: Request, status: number, startedAt: bigint): void {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    this.logger.event(status >= 500 ? 'error' : 'log', 'request', {
      method: request.method,
      path: request.route?.path ?? request.path,
      status,
      durationMs: Math.round(durationMs * 100) / 100,
    });
  }
}
