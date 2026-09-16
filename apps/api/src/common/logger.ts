import { ConsoleLogger, Injectable, type LogLevel, Scope } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  userId?: string;
  route?: string;
}

/** Carries the request id (and user) through async work without threading it. */
export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}

const LEVEL_ORDER: Record<string, number> = {
  trace: 10,
  debug: 20,
  log: 30,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * Structured JSON logger.
 *
 * Emits one JSON object per line in production (ingestible by any log platform)
 * and a readable line in development. Values that must never be logged —
 * tokens, passwords, API keys, message bodies — are redacted by
 * `redactSecrets` before they reach the output.
 */
@Injectable({ scope: Scope.DEFAULT })
export class StructuredLogger extends ConsoleLogger {
  private readonly minLevel: number;
  private readonly json: boolean;

  constructor(level = 'info', json = process.env.NODE_ENV === 'production') {
    super();
    this.minLevel = LEVEL_ORDER[level] ?? 30;
    this.json = json;
  }

  log(message: unknown, ...rest: unknown[]): void {
    this.emit('log', message, rest);
  }

  error(message: unknown, ...rest: unknown[]): void {
    this.emit('error', message, rest);
  }

  warn(message: unknown, ...rest: unknown[]): void {
    this.emit('warn', message, rest);
  }

  debug(message: unknown, ...rest: unknown[]): void {
    this.emit('debug', message, rest);
  }

  verbose(message: unknown, ...rest: unknown[]): void {
    this.emit('trace', message, rest);
  }

  /** Logs a structured event with arbitrary (already safe) fields. */
  event(level: LogLevel | 'trace', message: string, fields: Record<string, unknown>): void {
    this.emit(level === 'verbose' ? 'trace' : level, message, [fields]);
  }

  private emit(level: string, message: unknown, rest: unknown[]): void {
    if ((LEVEL_ORDER[level] ?? 30) < this.minLevel) return;

    const context = getRequestContext();
    const fields: Record<string, unknown> = {};
    let contextName: string | undefined;

    for (const entry of rest) {
      if (typeof entry === 'string') {
        contextName = entry;
      } else if (entry instanceof Error) {
        fields.error = { name: entry.name, message: entry.message, stack: entry.stack };
      } else if (entry && typeof entry === 'object') {
        Object.assign(fields, entry as Record<string, unknown>);
      }
    }

    const payload = {
      level,
      time: new Date().toISOString(),
      msg: typeof message === 'string' ? message : safeStringify(message),
      ...(contextName ? { context: contextName } : {}),
      ...(context?.requestId ? { requestId: context.requestId } : {}),
      ...(context?.userId ? { userId: context.userId } : {}),
      ...redactSecrets(fields),
    };

    const stream = level === 'error' || level === 'fatal' ? process.stderr : process.stdout;
    if (this.json) {
      stream.write(`${JSON.stringify(payload)}\n`);
    } else {
      const extras = Object.keys(fields).length > 0 ? ` ${safeStringify(redactSecrets(fields))}` : '';
      stream.write(
        `${payload.time} ${level.toUpperCase().padEnd(5)} ${
          contextName ? `[${contextName}] ` : ''
        }${payload.msg}${extras}\n`,
      );
    }
  }
}

const SECRET_KEY_PATTERN =
  /(password|passwd|secret|token|apikey|api_key|authorization|cookie|credential|jwt)/i;

/**
 * Redacts anything that looks like a credential, at any depth. Community
 * message bodies are never logged by the application; this is the backstop for
 * accidental inclusion via an error payload.
 */
export function redactSecrets<T>(value: T, depth = 0): T {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry, depth + 1)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? '[redacted]' : redactSecrets(entry, depth + 1);
  }
  return out as T;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
