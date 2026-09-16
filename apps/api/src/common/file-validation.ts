import { extname } from 'node:path';
import { AppException, ERROR_CODES } from './errors';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface FileRule {
  /** Accepted MIME types. */
  mimeTypes: readonly string[];
  /** Accepted lower-case extensions, including the dot. */
  extensions: readonly string[];
  maxBytes: number;
  label: string;
}

/**
 * Magic-number prefixes for the formats where the container is unambiguous.
 *
 * A browser-supplied Content-Type is a hint, not a fact, so for PDF and the ZIP
 * family (DOCX) we also check what the bytes actually are. Text formats have no
 * signature and are validated by decoding instead.
 */
const SIGNATURES: Array<{ test: (buffer: Buffer) => boolean; extensions: string[] }> = [
  { test: (buffer) => buffer.subarray(0, 5).toString('latin1') === '%PDF-', extensions: ['.pdf'] },
  {
    // All Office Open XML files are ZIP archives.
    test: (buffer) => buffer[0] === 0x50 && buffer[1] === 0x4b,
    extensions: ['.docx'],
  },
];

export function validateUpload(file: UploadedFile | undefined, rule: FileRule): UploadedFile {
  if (!file || !file.buffer || file.size === 0) {
    throw AppException.badRequest('No file was uploaded, or the file is empty.');
  }

  if (file.size > rule.maxBytes) {
    throw new AppException(
      ERROR_CODES.PAYLOAD_TOO_LARGE,
      `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(rule.maxBytes)}.`,
      413,
    );
  }

  const extension = extname(file.originalname).toLowerCase();
  const mimeOk = rule.mimeTypes.includes(file.mimetype);
  const extensionOk = rule.extensions.includes(extension);

  // Either signal may be missing or wrong on its own (browsers send
  // application/octet-stream for unfamiliar types), so one of the two must
  // match and neither may actively contradict the rule.
  if (!mimeOk && !extensionOk) {
    throw new AppException(
      ERROR_CODES.UNSUPPORTED_FILE_TYPE,
      `"${file.originalname}" is not a supported ${rule.label}. Accepted: ${rule.extensions.join(', ')}.`,
      415,
    );
  }

  const signature = SIGNATURES.find((entry) => entry.extensions.includes(extension));
  if (signature && !signature.test(file.buffer)) {
    throw new AppException(
      ERROR_CODES.UNSUPPORTED_FILE_TYPE,
      `"${file.originalname}" does not contain valid ${extension.slice(1).toUpperCase()} data.`,
      415,
    );
  }

  return file;
}

/** Text uploads are validated by decoding: reject anything with NUL bytes. */
export function decodeTextUpload(file: UploadedFile): string {
  if (file.buffer.includes(0x00)) {
    throw new AppException(
      ERROR_CODES.UNSUPPORTED_FILE_TYPE,
      `"${file.originalname}" looks like a binary file, not text.`,
      415,
    );
  }
  const text = file.buffer.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
