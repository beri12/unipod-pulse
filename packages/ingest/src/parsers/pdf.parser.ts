import {
  DocumentExtractionError,
  finalise,
  hasExtension,
  type DocumentParser,
  type ExtractedPage,
  type ExtractionResult,
} from './document-parser';

interface PdfTextItem {
  str?: string;
  transform?: number[];
  hasEOL?: boolean;
}

interface PdfPage {
  getTextContent(options?: Record<string, unknown>): Promise<{ items: unknown[] }>;
  cleanup(): void;
}

interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  getMetadata(): Promise<{ info?: Record<string, unknown> }>;
  destroy(): Promise<void>;
}

type GetDocument = (options: Record<string, unknown>) => { promise: Promise<PdfDocument> };

/**
 * PDF text extraction with page numbers preserved.
 *
 * Page provenance matters: a citation reading "Hackathon Guidelines, page 4" is
 * checkable, one reading "Hackathon Guidelines" is not. pdf.js is driven
 * directly rather than through a wrapper so each page can be read separately,
 * and so line breaks can be rebuilt from the text items' positions — pdf.js
 * returns positioned glyph runs, not lines.
 *
 * The library is loaded lazily and by its ESM legacy build, which is the one
 * built for Node.
 */
export class PdfParser implements DocumentParser {
  readonly name = 'pdf';
  private getDocument: GetDocument | null = null;

  supports(mimeType: string, fileName: string): boolean {
    return mimeType === 'application/pdf' || hasExtension(fileName, '.pdf');
  }

  private async loadPdfjs(): Promise<GetDocument> {
    if (this.getDocument) return this.getDocument;
    const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as {
      getDocument: GetDocument;
    };
    this.getDocument = pdfjs.getDocument;
    return this.getDocument;
  }

  async extract(buffer: Buffer): Promise<ExtractionResult> {
    const getDocument = await this.loadPdfjs();
    let document: PdfDocument | null = null;

    try {
      document = await getDocument({
        // A copy, because pdf.js takes ownership of the buffer it is given.
        data: new Uint8Array(buffer),
        useSystemFonts: true,
        // No script execution for untrusted uploads.
        isEvalSupported: false,
        disableFontFace: true,
      }).promise;

      const pages: ExtractedPage[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push({ page: pageNumber, text: itemsToText(content.items as PdfTextItem[]) });
        page.cleanup();
      }

      if (pages.every((page) => page.text.trim().length === 0)) {
        throw new DocumentExtractionError(
          'No text could be extracted from this PDF. It may be a scanned image, which needs OCR before it can be indexed.',
        );
      }

      const metadata = await document.getMetadata().catch(() => ({ info: undefined }));
      return finalise(pages, {
        pageCount: document.numPages,
        title: asString(metadata.info?.Title),
        author: asString(metadata.info?.Author),
      });
    } catch (error) {
      if (error instanceof DocumentExtractionError) throw error;
      throw new DocumentExtractionError(`This PDF could not be read: ${(error as Error).message}`);
    } finally {
      await document?.destroy().catch(() => undefined);
    }
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * Rebuilds readable lines from positioned glyph runs. A new line starts when
 * the baseline moves vertically; otherwise runs are joined with a space unless
 * they already touch.
 */
function itemsToText(items: PdfTextItem[]): string {
  let text = '';
  let lastY: number | null = null;

  for (const item of items) {
    const value = item.str ?? '';
    if (value === '') {
      if (item.hasEOL) text += '\n';
      continue;
    }
    const y = item.transform?.[5];

    if (lastY !== null && typeof y === 'number' && Math.abs(y - lastY) > 1) {
      text += '\n';
    } else if (text.length > 0 && !/\s$/.test(text) && !/^\s/.test(value)) {
      text += ' ';
    }

    text += value;
    if (item.hasEOL) text += '\n';
    if (typeof y === 'number') lastY = y;
  }

  return text;
}
