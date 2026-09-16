/**
 * Regenerates the binary parser fixtures.
 *
 * They are committed so the test suite needs no generator at run time, but they
 * are produced by real writers (pdfkit, and a hand-built OOXML package) rather
 * than being opaque blobs of unknown provenance.
 *
 * Run with: node scripts/make-test-fixtures.mjs
 */
import PDFDocument from 'pdfkit';
import { createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages/ingest/src/__tests__/fixtures');

async function writePdf() {
  const path = join(OUT, 'sample.pdf');
  // A fixed creation date keeps the output byte-identical between runs, so
  // regenerating a fixture only shows up in the diff when its content changed.
  const doc = new PDFDocument({
    size: 'LETTER',
    margin: 72,
    info: { CreationDate: new Date(Date.UTC(2026, 0, 1)) },
  });
  const stream = createWriteStream(path);
  const done = new Promise((resolve) => stream.on('finish', resolve));
  doc.pipe(stream);

  doc.fontSize(18).text('UniPods Parser Fixture');
  doc.moveDown().fontSize(12);
  doc.text('Key dates');
  doc.text('The verification window opens on Monday, October 5, 2026.');
  doc.text('The zenithal review checkpoint is Friday, October 9, 2026.');
  doc.addPage();
  doc.fontSize(18).text('Second page');
  doc.moveDown().fontSize(12);
  doc.text('The second page keyword is marmalade-protocol.');
  doc.end();

  await done;
  return path;
}

/** Minimal but valid Office Open XML, written without a heavyweight dependency. */
async function writeDocx() {
  const path = join(OUT, 'sample.docx');
  const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paragraph = (text, style) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}` +
    `<w:r><w:t xml:space="preserve">${escape(text)}</w:t></w:r></w:p>`;

  const body = [
    paragraph('UniPods Parser Fixture', 'Heading1'),
    paragraph('This document exists to verify DOCX extraction.'),
    paragraph('Key dates', 'Heading2'),
    paragraph('The verification window opens on Monday, October 5, 2026.'),
    paragraph('Requirements', 'Heading2'),
    paragraph('Every submission must include a quorated attendance sheet.'),
  ].join('');

  const files = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
    'word/document.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${body}</w:body></w:document>`,
  };

  await writeFile(path, zip(files));
  return path;
}

/** Writes a ZIP archive with deflated entries and a central directory. */
function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const compressed = deflateRawSync(data);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, compressed);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBytes);

    offset += local.length + nameBytes.length + compressed.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, directory, end]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

console.log('wrote', await writePdf());
console.log('wrote', await writeDocx());
