import { ApiError } from './api/client';

/**
 * Turns anything thrown by the API client into a sentence worth showing a
 * person. The API already returns human-readable messages, so those are used
 * directly; only transport failures need a message written here.
 */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.details?.length) {
      return `${error.message} ${error.details.map((detail) => detail.message).join(' ')}`;
    }
    return error.message;
  }
  if (error instanceof TypeError) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

export { ApiError };
