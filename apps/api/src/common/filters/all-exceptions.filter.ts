import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AiCapabilityUnavailableError, AiProviderError } from '@unipods/ai';
import type { ApiErrorBody } from '@unipods/types';
import type { Request, Response } from 'express';
import { AppException, ERROR_CODES, type AppErrorDetail, type ErrorCode } from '../errors';
import { getRequestContext, StructuredLogger } from '../logger';

/**
 * Turns every thrown value into the single documented error envelope:
 * `{ success: false, error: { code, message, details?, requestId } }`.
 *
 * Internal failures never leak their message to the client — the detail goes to
 * the log with the request id so support can correlate the two.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: StructuredLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request & { requestId?: string }>();
    const requestId = request.requestId ?? getRequestContext()?.requestId;

    const { status, code, message, details } = this.describe(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Deliberate failures (a queue being down, storage refusing a write)
      // carry a code and a useful message; only genuinely unexpected throws
      // need a stack trace.
      if (exception instanceof AppException) {
        this.logger.error(`${code} on ${request.method} ${request.url}`, { status }, 'Http');
      } else {
        this.logger.error(`Unhandled error on ${request.method} ${request.url}`, exception, 'Http');
      }
    } else if (status === HttpStatus.UNAUTHORIZED || status === HttpStatus.FORBIDDEN) {
      this.logger.warn(`${status} on ${request.method} ${request.url}`, { code }, 'Http');
    }

    const body: ApiErrorBody = {
      success: false,
      error: { code, message, ...(details ? { details } : {}), ...(requestId ? { requestId } : {}) },
    };
    response.status(status).json(body);
  }

  private describe(exception: unknown): {
    status: number;
    code: ErrorCode;
    message: string;
    details?: AppErrorDetail[];
  } {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof AiCapabilityUnavailableError) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: ERROR_CODES.TRANSCRIPTION_UNAVAILABLE,
        message: exception.message,
      };
    }

    if (exception instanceof AiProviderError) {
      return {
        status: HttpStatus.BAD_GATEWAY,
        code: ERROR_CODES.AI_PROVIDER_ERROR,
        message: 'The AI provider could not complete this request. Please try again.',
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      return {
        status,
        code: statusToCode(status),
        message: extractMessage(payload, exception.message),
        details: extractDetails(payload),
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'Something went wrong on our side. The incident has been logged.',
    };
  }
}

function statusToCode(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return ERROR_CODES.VALIDATION_FAILED;
    case HttpStatus.UNAUTHORIZED:
      return ERROR_CODES.UNAUTHORIZED;
    case HttpStatus.FORBIDDEN:
      return ERROR_CODES.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ERROR_CODES.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ERROR_CODES.CONFLICT;
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return ERROR_CODES.PAYLOAD_TOO_LARGE;
    case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
      return ERROR_CODES.UNSUPPORTED_FILE_TYPE;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ERROR_CODES.RATE_LIMITED;
    default:
      return status >= 500 ? ERROR_CODES.INTERNAL_ERROR : ERROR_CODES.VALIDATION_FAILED;
  }
}

function extractMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    if (Array.isArray(record.message) && record.message.length > 0) {
      return `Request validation failed: ${(record.message as string[])[0]}`;
    }
  }
  return fallback;
}

/** class-validator returns `message: string[]`; surface them as field details. */
function extractDetails(payload: unknown): AppErrorDetail[] | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.details)) return record.details as AppErrorDetail[];
  if (Array.isArray(record.message)) {
    return (record.message as string[]).map((message) => {
      const field = message.split(' ')[0] ?? 'body';
      return { field, message };
    });
  }
  return undefined;
}
