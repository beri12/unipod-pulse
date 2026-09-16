import { DocumentExtractionError, type DocumentParser } from './document-parser';
import { DocxParser } from './docx.parser';
import { PdfParser } from './pdf.parser';
import { MarkdownParser, TxtParser } from './text.parser';

export * from './document-parser';
export { DocxParser, MarkdownParser, PdfParser, TxtParser };

/** Ordered most-specific first; markdown must win over plain text. */
export const DOCUMENT_PARSERS: DocumentParser[] = [
  new PdfParser(),
  new DocxParser(),
  new MarkdownParser(),
  new TxtParser(),
];

export function resolveParser(mimeType: string, fileName: string): DocumentParser {
  const parser = DOCUMENT_PARSERS.find((candidate) => candidate.supports(mimeType, fileName));
  if (!parser) {
    throw new DocumentExtractionError(
      `No parser can read "${fileName}" (${mimeType}). Supported formats: PDF, DOCX, TXT, Markdown.`,
    );
  }
  return parser;
}
