import {
  DocumentExtractionError,
  finalise,
  hasExtension,
  type DocumentParser,
  type ExtractedPage,
  type ExtractionResult,
} from './document-parser';

export class TxtParser implements DocumentParser {
  readonly name = 'txt';

  supports(mimeType: string, fileName: string): boolean {
    return mimeType === 'text/plain' || hasExtension(fileName, '.txt', '.text', '.log');
  }

  async extract(buffer: Buffer): Promise<ExtractionResult> {
    const text = decode(buffer);
    if (!text.trim()) throw new DocumentExtractionError('This text file is empty.');
    return finalise([{ text }], { format: 'txt' });
  }
}

/**
 * Markdown keeps its heading structure so chunks can be attributed to a
 * section, which makes citations far more useful than a bare file name.
 */
export class MarkdownParser implements DocumentParser {
  readonly name = 'markdown';

  supports(mimeType: string, fileName: string): boolean {
    return (
      mimeType === 'text/markdown' ||
      mimeType === 'text/x-markdown' ||
      hasExtension(fileName, '.md', '.markdown', '.mdx')
    );
  }

  async extract(buffer: Buffer): Promise<ExtractionResult> {
    const raw = decode(buffer);
    if (!raw.trim()) throw new DocumentExtractionError('This markdown file is empty.');

    const sections: ExtractedPage[] = [];
    let currentSection: string | undefined;
    let buffered: string[] = [];
    let inFence = false;

    const flush = () => {
      const text = buffered.join('\n').trim();
      if (text) sections.push({ section: currentSection, text });
      buffered = [];
    };

    for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
      if (/^\s*```/.test(line)) inFence = !inFence;
      const heading = !inFence ? /^(#{1,3})\s+(.*)$/.exec(line) : null;
      if (heading) {
        flush();
        currentSection = (heading[2] ?? '').trim();
        buffered.push(currentSection);
      } else {
        buffered.push(line);
      }
    }
    flush();

    return finalise(sections.length > 0 ? sections : [{ text: raw }], {
      format: 'markdown',
      sections: sections.length,
    });
  }
}

/** Decodes UTF-8, tolerating and stripping a byte-order mark. */
function decode(buffer: Buffer): string {
  const text = buffer.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
