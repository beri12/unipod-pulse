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

interface PdfPageData {
  pageNumber?: number;
  getTextContent(options?: Record<string, unknown>): Promise<{ items: PdfTextItem[] }>;
}

type PdfParseFn = (
  buffer: Buffer,
  options?: { pagerender?: (page: PdfPageData) => Promise<string>; max?: number },
) => Promise<{ text: string; numpages: number; info?: Record<string, unknown> }>;

/**
 * PDF text extraction with page numbers preserved.
 *
 * Page provenance matters: a citation that says "Hackathon Guidelines, page 4"
 * is checkable, one that says "Hackathon Guidelines" is not. `pdf-parse` only
 * returns a flat string, so we supply our own page renderer that captures each
 * page separately and rebuilds line breaks from the text items' y positions.
 */
export class PdfParser implements DocumentParser {
  readonly name = 'pdf';

  supports(mimeType: string, fileName: string): boolean {
    return mimeType === 'application/pdf' || hasExtension(fileName, '.pdf');
  }

  async extract(buffer: Buffer): Promise<ExtractionResult> {
    const pages: ExtractedPage[] = [];
    let pageCursor = 0;

    // Required lazily and by its library path: the package's index file runs a
    // self-test when it thinks it is the entry module.
    const pdfParse = require('pdf-parse/lib/pdf-parse.js') as PdfParseFn;

    try {
      const result = await pdfParse(buffer, {
        pagerender: async (pageData: PdfPageData) => {
          pageCursor += 1;
          const pageNumber = pageData.pageNumber ?? pageCursor;
          const content = await pageData.getTextContent({
            includeMarkedContent: false,
            disableCombineTextItems: false,
          });
          const text = itemsToText(content.items);
          pages.push({ page: pageNumber, text });
          return text;
        },
      });

      if (pages.length === 0 && result.text.trim().length > 0) {
        pages.push({ page: 1, text: result.text });
      }

      if (pages.every((page) => page.text.trim().length === 0)) {
        throw new DocumentExtractionError(
          'No text could be extracted from this PDF. It may be a scanned image, which needs OCR before it can be indexed.',
        );
      }

      pages.sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
      return finalise(pages, {
        pageCount: result.numpages ?? pages.length,
        title: typeof result.info?.Title === 'string' ? result.info.Title : undefined,
        author: typeof result.info?.Author === 'string' ? result.info.Author : undefined,
      });
    } catch (error) {
      if (error instanceof DocumentExtractionError) throw error;
      throw new DocumentExtractionError(
        `This PDF could not be read: ${(error as Error).message}`,
      );
    }
  }
}

/**
 * Rebuilds readable lines from positioned glyph runs. A new line starts when
 * the item's baseline moves vertically; otherwise runs are joined with a space
 * unless they already touch.
 */
function itemsToText(items: PdfTextItem[]): string {
  let text = '';
  let lastY: number | null = null;

  for (const item of items) {
    const value = item.str ?? '';
    if (value === '') continue;
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
