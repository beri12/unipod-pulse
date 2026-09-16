import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import type { Env } from '@unipods/config';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { AppException, ERROR_CODES } from '../common/errors';
import { StructuredLogger } from '../common/logger';
import { ENV } from '../config/config.module';

export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
}

export interface StorageAdapter {
  readonly name: string;
  upload(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Time-limited URL. Private objects are never exposed by a permanent URL. */
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
  healthCheck(): Promise<void>;
}

/**
 * Builds a collision-free, path-traversal-proof storage key.
 *
 * The client-supplied file name only contributes a sanitised extension and a
 * short slug; the identity of the object is a UUID we generate.
 */
export function buildStorageKey(prefix: string, originalName: string): string {
  const extension = extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, '');
  const safeExtension = /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : '';
  const slug =
    originalName
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'file';
  const now = new Date();
  const datePath = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${prefix}/${datePath}/${randomUUID()}-${slug}${safeExtension}`;
}

class S3StorageAdapter implements StorageAdapter {
  readonly name = 's3';
  private readonly client: S3Client;

  constructor(private readonly env: Env) {
    this.client = new S3Client({
      region: env.S3_REGION,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY as string,
        secretAccessKey: env.S3_SECRET_KEY as string,
      },
    });
  }

  private get bucket(): string {
    return this.env.S3_BUCKET as string;
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Uploads are private; access is only ever granted via a signed URL.
        ACL: undefined,
      }),
    );
    return { key, size: body.byteLength, contentType };
  }

  async download(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const body = result.Body;
    if (!body) throw new Error(`Object ${key} has no body.`);
    return Buffer.from(await body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  async healthCheck(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}

/**
 * Filesystem adapter for local development. Files are served through the API's
 * signed download route rather than a static directory, so the same
 * authorisation rules apply as in production.
 */
class LocalStorageAdapter implements StorageAdapter {
  readonly name = 'local';
  private readonly root: string;

  constructor(
    env: Env,
    private readonly apiUrl: string,
    private readonly signingSecret: string,
  ) {
    // Already absolute: @unipods/config anchors it to the monorepo root.
    this.root = resolve(env.LOCAL_STORAGE_DIR);
  }

  private pathFor(key: string): string {
    const target = resolve(this.root, key);
    // Defence in depth: keys are generated server-side, but a stored key must
    // never be able to escape the storage root.
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new AppException(
        ERROR_CODES.STORAGE_ERROR,
        'Invalid storage key.',
        400,
      );
    }
    return target;
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return { key, size: body.byteLength, contentType };
  }

  async download(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    // The local driver has no signing service, so the API signs the URL itself
    // with an HMAC and verifies it on the download route. The expiry is part of
    // the signed payload, so it cannot be extended by editing the query string.
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const signature = signLocalKey(this.signingSecret, key, expires);
    return `${this.apiUrl}/api/storage/${encodeURIComponent(key)}?expires=${expires}&signature=${signature}`;
  }

  async healthCheck(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await stat(this.root);
  }

  createReadStream(key: string) {
    return createReadStream(this.pathFor(key));
  }

  absolutePath(key: string): string {
    return this.pathFor(key);
  }
}

@Injectable()
export class StorageService {
  private readonly adapter: StorageAdapter;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly logger: StructuredLogger,
  ) {
    this.adapter =
      env.STORAGE_DRIVER === 's3'
        ? new S3StorageAdapter(env)
        : new LocalStorageAdapter(env, env.API_URL, env.JWT_SECRET);
    this.logger.log(`Storage driver: ${this.adapter.name}`, 'Storage');
  }

  get driver(): string {
    return this.adapter.name;
  }

  async upload(prefix: string, originalName: string, body: Buffer, contentType: string) {
    const key = buildStorageKey(prefix, originalName);
    try {
      return await this.adapter.upload(key, body, contentType);
    } catch (error) {
      this.logger.error('Upload failed', error as Error, 'Storage');
      throw new AppException(
        ERROR_CODES.STORAGE_ERROR,
        'The file could not be stored. Please try again.',
        502,
      );
    }
  }

  async download(key: string): Promise<Buffer> {
    try {
      return await this.adapter.download(key);
    } catch (error) {
      this.logger.error('Download failed', error as Error, 'Storage');
      throw new AppException(
        ERROR_CODES.STORAGE_ERROR,
        'The stored file could not be read.',
        502,
      );
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.adapter.delete(key);
    } catch (error) {
      // A missing object must not block deleting the database row.
      this.logger.warn('Delete failed; continuing', { key, reason: (error as Error).message }, 'Storage');
    }
  }

  signedUrl(key: string, expiresInSeconds = 900): Promise<string> {
    return this.adapter.getSignedUrl(key, expiresInSeconds);
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.adapter.healthCheck();
      return { ok: true };
    } catch (error) {
      return { ok: false, detail: (error as Error).message };
    }
  }

  /** Local-driver escape hatch used by the authenticated download route. */
  localPath(key: string): string | null {
    if (this.adapter instanceof LocalStorageAdapter) {
      return this.adapter.absolutePath(key);
    }
    return null;
  }

  joinLocal(...parts: string[]): string {
    return join(...parts);
  }

  /** Verifies a locally signed download URL. Returns false when invalid or expired. */
  verifyLocalSignature(key: string, expires: number, signature: string): boolean {
    if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;
    const expected = signLocalKey(this.env.JWT_SECRET, key, expires);
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

function signLocalKey(secret: string, key: string, expires: number): string {
  return createHmac('sha256', secret).update(`${key}:${expires}`).digest('hex').slice(0, 32);
}
