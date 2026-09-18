import { createHmac } from 'node:crypto';
import { isValidCloudSignature } from './cloud-signature.js';

const SECRET = 'test-app-secret';
const sign = (body: Buffer, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('isValidCloudSignature', () => {
  const body = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }));

  it('accepts a signature made with the app secret', () => {
    expect(isValidCloudSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a signature made with a different secret', () => {
    expect(isValidCloudSignature(body, sign(body, 'wrong-secret'), SECRET)).toBe(false);
  });

  it('rejects a body that was modified after signing', () => {
    const signature = sign(body);
    const tampered = Buffer.from(JSON.stringify({ object: 'evil' }));

    expect(isValidCloudSignature(tampered, signature, SECRET)).toBe(false);
  });

  it('rejects a missing or malformed header', () => {
    expect(isValidCloudSignature(body, undefined, SECRET)).toBe(false);
    expect(isValidCloudSignature(body, 'sha1=abc', SECRET)).toBe(false);
    expect(isValidCloudSignature(body, 'sha256=', SECRET)).toBe(false);
  });

  it('rejects a signature of the wrong length without throwing', () => {
    expect(isValidCloudSignature(body, 'sha256=ab', SECRET)).toBe(false);
  });

  it('rejects when there is no raw body to hash', () => {
    expect(isValidCloudSignature(undefined, sign(body), SECRET)).toBe(false);
  });
});
