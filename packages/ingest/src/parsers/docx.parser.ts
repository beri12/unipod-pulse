import {
  DocumentExtractionError,
  finalise,
  hasExtension,
  type DocumentParser,
  type ExtractedPage,
  type ExtractionResult,
} from './document-parser';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * DOCX extraction via mammoth.
 *
 * Word files have no page concept in the XML, so instead of inventing page
 * numbers we keep the heading structure: mammoth's HTML output is split on
 * `<h1>`-`<h3>` and each block is tagged with the heading above it. Citations
 * then read "Requirements" rather than a made-up page.
 */
export class DocxParser implements DocumentParser {
  readonly name = 'docx';

  supports(mimeType: string, fileName: string): boolean {
    return (
      mimeType === DOCX_MIME ||
      mimeType === 'application/msword' ||
      hasExtension(fileName, '.docx')
    );
  }

  async extract(buffer: Buffer): Promise<ExtractionResult> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mammoth = require('mammoth') as {
      convertToHtml(input: { buffer: Buffer }): Promise<{ value: string; messages: unknown[] }>;
    };

    try {
      const { value: html } = await mammoth.convertToHtml({ buffer });
      const pages = htmlToSections(html);
      if (pages.length === 0) {
        throw new DocumentExtractionError('This Word document appears to contain no text.');
      }
      return finalise(pages, { format: 'docx', sections: pages.length });
    } catch (error) {
      if (error instanceof DocumentExtractionError) throw error;
      throw new DocumentExtractionError(
        `This Word document could not be read: ${(error as Error).message}`,
      );
    }
  }
}

function htmlToSections(html: string): ExtractedPage[] {
  const sections: ExtractedPage[] = [];
  let currentSection: string | undefined;
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) sections.push({ section: currentSection, text });
    buffer = [];
  };

  const blockPattern = /<(h[1-6]|p|li|tr)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(html)) !== null) {
    const tag = (match[1] ?? '').toLowerCase();
    const text = stripTags(match[2] ?? '');
    if (!text) continue;
    if (/^h[1-3]$/.test(tag)) {
      flush();
      currentSection = text;
      buffer.push(text);
    } else {
      buffer.push(text);
    }
  }
  flush();

  if (sections.length === 0) {
    const plain = stripTags(html);
    if (plain) sections.push({ text: plain });
  }
  return sections;
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number.parseInt(code, 10)))
    .trim();
}
