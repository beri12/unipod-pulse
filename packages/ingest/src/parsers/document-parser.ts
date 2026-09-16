import { cleanExtractedText } from '@unipods/ai';

export interface ExtractedPage {
  /** 1-based page number, or undefined for formats without pages. */
  page?: number;
  /** Heading this block sits under, when the format exposes one. */
  section?: string;
  text: string;
}

export interface ExtractionResult {
  text: string;
  pages: ExtractedPage[];
  metadata: Record<string, unknown>;
}

export interface DocumentParser {
  readonly name: string;
  supports(mimeType: string, fileName: string): boolean;
  extract(buffer: Buffer, fileName: string): Promise<ExtractionResult>;
}

export class DocumentExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentExtractionError';
  }
}

export function hasExtension(fileName: string, ...extensions: string[]): boolean {
  const lower = fileName.toLowerCase();
  return extensions.some((extension) => lower.endsWith(extension));
}

/** Shared post-processing so every parser yields comparable output. */
export function finalise(pages: ExtractedPage[], metadata: Record<string, unknown>): ExtractionResult {
  const cleaned = pages
    .map((page) => ({ ...page, text: cleanExtractedText(page.text) }))
    .filter((page) => page.text.length > 0);
  return {
    text: cleaned.map((page) => page.text).join('\n\n'),
    pages: cleaned,
    metadata,
  };
}
