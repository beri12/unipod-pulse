import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies Meta's `X-Hub-Signature-256` header against the raw request body.
 *
 * The hash is over the exact bytes Meta sent, so this must run on the raw
 * buffer — re-serialising the parsed JSON produces a different digest.
 */
export function isValidCloudSignature(
  rawBody: Buffer | undefined,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!rawBody || !header) return false;

  const [algorithm, received] = header.split('=');
  if (algorithm !== 'sha256' || !received) return false;

  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const receivedBuffer = Buffer.from(received, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');

  // timingSafeEqual throws on a length mismatch, so guard first.
  if (receivedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(receivedBuffer, expectedBuffer);
}
