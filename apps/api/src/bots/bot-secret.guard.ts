import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Env } from '@unipods/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { AppException } from '../common/errors';
import { ENV } from '../config/config.module';

export const BOT_SECRET_HEADER = 'x-bot-secret';

/**
 * Authenticates automation (n8n, a webhook relay) by shared secret.
 *
 * These routes carry no user session — the caller is a machine — so they are
 * marked `@Public()` to skip the JWT guard and gated here instead. Two
 * deliberate choices: with no `BOT_INGEST_SECRET` configured the routes are
 * *refused* rather than left open, so forgetting to set it cannot silently
 * expose an ingestion endpoint to the internet; and the comparison is
 * constant-time, so a wrong secret leaks nothing through response timing.
 */
@Injectable()
export class BotSecretGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.env.BOT_INGEST_SECRET;
    if (!expected) {
      throw AppException.forbidden(
        'Bot endpoints are disabled. Set BOT_INGEST_SECRET to enable them.',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers[BOT_SECRET_HEADER];
    const provided = Array.isArray(header) ? header[0] : header;

    if (!provided || !secretsMatch(provided, expected)) {
      throw AppException.forbidden('Invalid bot secret.');
    }

    return true;
  }
}

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // expected length, so compare against a same-length buffer and fold the
  // length check into the result.
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}
