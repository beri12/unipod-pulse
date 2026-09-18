export interface Chunk {
  text: string;
  part: number;
  parts: number;
}

/**
 * Splits a long transcript or document into overlapping chunks.
 *
 * Splits on blank lines first, then on single lines, so a speaker turn in a
 * call transcript is never cut in half. The overlap carries the tail of one
 * chunk into the next, so an answer that straddles a boundary is still found.
 */
export function chunkText(text: string, size = 1400, overlap = 200): Chunk[] {
  const normalised = text.replace(/\r\n/g, '\n').trim();
  if (!normalised) return [];
  if (normalised.length <= size) return [{ text: normalised, part: 1, parts: 1 }];

  const blocks = splitIntoBlocks(normalised, size);
  const texts: string[] = [];
  let current = '';

  for (const block of blocks) {
    if (current && current.length + block.length + 2 > size) {
      texts.push(current.trim());
      current = tailOf(current, overlap);
    }
    current = current ? `${current}\n\n${block}` : block;
  }
  if (current.trim()) texts.push(current.trim());

  return texts.map((chunk, index) => ({
    text: chunk,
    part: index + 1,
    parts: texts.length,
  }));
}

/** Paragraphs, falling back to lines and then to hard cuts for huge blocks. */
function splitIntoBlocks(text: string, size: number): string[] {
  const blocks: string[] = [];

  for (const paragraph of text.split(/\n\s*\n/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    if (trimmed.length <= size) {
      blocks.push(trimmed);
      continue;
    }

    for (const line of trimmed.split('\n')) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      if (trimmedLine.length <= size) {
        blocks.push(trimmedLine);
        continue;
      }
      // A single line longer than a whole chunk (a transcript with no line
      // breaks at all): cut it, since there is no natural boundary left.
      for (let at = 0; at < trimmedLine.length; at += size) {
        blocks.push(trimmedLine.slice(at, at + size));
      }
    }
  }

  return blocks;
}

/**
 * The last WHOLE lines of a chunk, up to `overlap` characters.
 *
 * Whole lines only: carrying half a sentence ("...ly call to Thursday.") into
 * the next chunk gives the model a fragment it can misread, and wastes the
 * space that was meant to preserve context. When even the last line does not
 * fit, no overlap is better than a broken one.
 */
function tailOf(text: string, overlap: number): string {
  if (overlap <= 0) return '';

  const lines = text.split('\n');
  const kept: string[] = [];
  let length = 0;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!;
    const cost = line.length + (kept.length > 0 ? 1 : 0);
    if (length + cost > overlap) break;
    kept.unshift(line);
    length += cost;
  }

  return kept.join('\n').trim();
}
