import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Stable machine-readable error codes. The frontend switches on these, so
 * treat them as part of the public API: add new ones rather than renaming.
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_FILE_TYPE: 'UNSUPPORTED_FILE_TYPE',
  DOCUMENT_PROCESSING_FAILED: 'DOCUMENT_PROCESSING_FAILED',
  MEETING_PROCESSING_FAILED: 'MEETING_PROCESSING_FAILED',
  MESSAGE_IMPORT_FAILED: 'MESSAGE_IMPORT_FAILED',
  TRANSCRIPTION_UNAVAILABLE: 'TRANSCRIPTION_UNAVAILABLE',
  AI_PROVIDER_ERROR: 'AI_PROVIDER_ERROR',
  STORAGE_ERROR: 'STORAGE_ERROR',
  QUEUE_UNAVAILABLE: 'QUEUE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface AppErrorDetail {
  field: string;
  message: string;
}

/** Every deliberate API failure is thrown as one of these. */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details?: AppErrorDetail[],
  ) {
    super({ code, message, details }, status);
  }

  static notFound(what: string): AppException {
    return new AppException(ERROR_CODES.NOT_FOUND, `${what} was not found.`, HttpStatus.NOT_FOUND);
  }

  static forbidden(message = 'You do not have access to this resource.'): AppException {
    return new AppException(ERROR_CODES.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }

  static unauthorized(message = 'Authentication is required.'): AppException {
    return new AppException(ERROR_CODES.UNAUTHORIZED, message, HttpStatus.UNAUTHORIZED);
  }

  static badRequest(
    message: string,
    code: ErrorCode = ERROR_CODES.VALIDATION_FAILED,
    details?: AppErrorDetail[],
  ): AppException {
    return new AppException(code, message, HttpStatus.BAD_REQUEST, details);
  }

  static conflict(message: string, code: ErrorCode = ERROR_CODES.CONFLICT): AppException {
    return new AppException(code, message, HttpStatus.CONFLICT);
  }

  static internal(message = 'Something went wrong on our side.'): AppException {
    return new AppException(
      ERROR_CODES.INTERNAL_ERROR,
      message,
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
