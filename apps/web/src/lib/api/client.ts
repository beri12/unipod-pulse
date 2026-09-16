import type { ApiErrorBody, AuthTokens } from '@unipods/types';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(
  /\/+$/,
  '',
);

const ACCESS_TOKEN_KEY = 'unipods.accessToken';
const REFRESH_TOKEN_KEY = 'unipods.refreshToken';

/**
 * Tokens live in localStorage.
 *
 * They are the signed-in user's own credentials, never an application secret —
 * no API key or provider credential ever reaches the browser. The hardening
 * step beyond this is httpOnly cookies plus CSRF protection, which needs the
 * API and the web app to share a site; it is noted in docs/security.md.
 */
export const tokenStore = {
  get access(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(ACCESS_TOKEN_KEY);
    } catch {
      return null;
    }
  },
  get refresh(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(REFRESH_TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(tokens: Pick<AuthTokens, 'accessToken' | 'refreshToken'>): void {
    try {
      window.localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
      window.localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    } catch {
      // Private browsing with storage disabled: the session simply will not
      // survive a reload, which is preferable to failing the sign-in.
    }
  },
  clear(): void {
    try {
      window.localStorage.removeItem(ACCESS_TOKEN_KEY);
      window.localStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch {
      /* nothing to clear */
    }
  },
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Array<{ field: string; message: string }>,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when re-authenticating could fix it. */
  get isAuthError(): boolean {
    return this.status === 401;
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Skips the Authorization header (used by login/register). */
  anonymous?: boolean;
  query?: Record<string, string | number | boolean | undefined | null>;
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Refreshes the access token at most once at a time, so a burst of 401s from
 * parallel queries produces a single refresh rather than a stampede that would
 * invalidate the rotating refresh token.
 */
async function refreshTokens(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) return false;

  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        tokenStore.clear();
        return false;
      }
      const data = (await response.json()) as AuthTokens;
      tokenStore.set(data);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${API_URL}/api${path.startsWith('/') ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    body = null;
  }
  const error = body?.error;
  return new ApiError(
    response.status,
    error?.code ?? 'UNKNOWN',
    error?.message ?? `Request failed with status ${response.status}.`,
    error?.details,
    error?.requestId,
  );
}

/**
 * The single place the browser talks to the API.
 *
 * Handles JSON and multipart bodies, attaches the access token, retries once
 * after refreshing on a 401, and converts every failure into an `ApiError` that
 * carries the API's own human-readable message.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, anonymous, query, headers, ...rest } = options;

  const send = async (): Promise<Response> => {
    const requestHeaders = new Headers(headers);
    const token = tokenStore.access;
    if (!anonymous && token) requestHeaders.set('Authorization', `Bearer ${token}`);

    let payload: BodyInit | undefined;
    if (body instanceof FormData) {
      // Let the browser set the multipart boundary.
      payload = body;
    } else if (body !== undefined) {
      requestHeaders.set('Content-Type', 'application/json');
      payload = JSON.stringify(body);
    }

    return fetch(buildUrl(path, query), { ...rest, headers: requestHeaders, body: payload });
  };

  let response = await send();

  if (response.status === 401 && !anonymous && tokenStore.refresh) {
    if (await refreshTokens()) {
      response = await send();
    }
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => apiFetch<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'DELETE' }),
};
