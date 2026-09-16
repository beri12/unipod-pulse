import { cleanExtractedText } from '@unipods/ai';
import { parse as parseCsv } from 'csv-parse/sync';

export interface NormalizedMessage {
  externalId: string | null;
  channel: string;
  authorName: string;
  authorId: string | null;
  content: string;
  messageDate: Date;
  /** External id of the message this replies to, resolved after insert. */
  replyToExternalId: string | null;
  isAnnouncement: boolean;
  metadata: Record<string, unknown>;
}

export interface ImportOutcome {
  messages: NormalizedMessage[];
  warnings: string[];
}

export interface ImportOptions {
  /** Channel name to use when the source format does not carry one. */
  channel?: string;
  /** Treat every imported message as an announcement (e.g. a noticeboard export). */
  markAsAnnouncement?: boolean;
}

export interface MessageImporter {
  readonly format: string;
  supports(format: string, fileName?: string): boolean;
  import(input: Buffer | string, options?: ImportOptions): Promise<ImportOutcome>;
}

export class MessageImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessageImportError';
  }
}

const MAX_WARNINGS = 25;

function asText(input: Buffer | string): string {
  const text = typeof input === 'string' ? input : input.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    // Heuristic: 10-digit values are seconds, 13-digit are milliseconds.
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && /^\d{9,13}$/.test(value.trim())) return toDate(numeric);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/** Messages that read like a broadcast are indexed as ANNOUNCEMENT sources. */
const ANNOUNCEMENT_HINTS =
  /\b(announcement|announcing|reminder|please note|attention all|important|deadline|official)\b/i;

function normalise(
  raw: Partial<NormalizedMessage> & { content: string; messageDate: Date; channel: string },
  options: ImportOptions,
): NormalizedMessage {
  const content = cleanExtractedText(raw.content);
  return {
    externalId: raw.externalId ?? null,
    channel: raw.channel,
    authorName: (raw.authorName ?? 'Unknown').toString().slice(0, 120),
    authorId: raw.authorId ?? null,
    content,
    messageDate: raw.messageDate,
    replyToExternalId: raw.replyToExternalId ?? null,
    isAnnouncement:
      raw.isAnnouncement ?? (options.markAsAnnouncement || ANNOUNCEMENT_HINTS.test(content)),
    metadata: raw.metadata ?? {},
  };
}

/**
 * Telegram Desktop export (`result.json`).
 *
 * Telegram stores message text either as a plain string or as an array of
 * formatted entities; both are flattened here so links and mentions survive.
 */
export class TelegramImporter implements MessageImporter {
  readonly format = 'telegram';

  supports(format: string, fileName?: string): boolean {
    return format === 'telegram' || (fileName ?? '').toLowerCase().includes('result.json');
  }

  async import(input: Buffer | string, options: ImportOptions = {}): Promise<ImportOutcome> {
    let payload: {
      name?: string;
      messages?: Array<Record<string, unknown>>;
      chats?: { list?: Array<{ name?: string; messages?: Array<Record<string, unknown>> }> };
    };
    try {
      payload = JSON.parse(asText(input));
    } catch (error) {
      throw new MessageImportError(`Not a valid Telegram export: ${(error as Error).message}`);
    }

    const chats = payload.chats?.list ?? [{ name: payload.name, messages: payload.messages }];
    const messages: NormalizedMessage[] = [];
    const warnings: string[] = [];

    for (const chat of chats) {
      const channel = options.channel ?? chat?.name ?? payload.name ?? 'Telegram';
      for (const entry of chat?.messages ?? []) {
        if (entry.type && entry.type !== 'message') continue;
        const content = flattenTelegramText(entry.text);
        if (!content.trim()) continue;
        const date = toDate(entry.date_unixtime ?? entry.date);
        if (!date) {
          if (warnings.length < MAX_WARNINGS) {
            warnings.push(`Skipped message ${String(entry.id)}: unreadable date.`);
          }
          continue;
        }
        messages.push(
          normalise(
            {
              externalId: entry.id !== undefined ? String(entry.id) : null,
              channel,
              authorName: String(entry.from ?? entry.actor ?? 'Unknown'),
              authorId: entry.from_id !== undefined ? String(entry.from_id) : null,
              content,
              messageDate: date,
              replyToExternalId:
                entry.reply_to_message_id !== undefined
                  ? String(entry.reply_to_message_id)
                  : null,
              metadata: { platform: 'telegram' },
            },
            options,
          ),
        );
      }
    }

    if (messages.length === 0) {
      throw new MessageImportError('No messages were found in this Telegram export.');
    }
    return { messages, warnings };
  }
}

function flattenTelegramText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) =>
        typeof part === 'string' ? part : String((part as { text?: unknown })?.text ?? ''),
      )
      .join('');
  }
  return '';
}

/** Generic JSON array or `{ messages: [...] }`. */
export class JsonImporter implements MessageImporter {
  readonly format = 'json';

  supports(format: string, fileName?: string): boolean {
    return format === 'json' || (fileName ?? '').toLowerCase().endsWith('.json');
  }

  async import(input: Buffer | string, options: ImportOptions = {}): Promise<ImportOutcome> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(asText(input));
    } catch (error) {
      throw new MessageImportError(`Invalid JSON: ${(error as Error).message}`);
    }

    const rows: Array<Record<string, unknown>> = Array.isArray(parsed)
      ? (parsed as Array<Record<string, unknown>>)
      : Array.isArray((parsed as { messages?: unknown }).messages)
        ? ((parsed as { messages: Array<Record<string, unknown>> }).messages)
        : [];

    if (rows.length === 0) {
      throw new MessageImportError(
        'Expected a JSON array of messages, or an object with a "messages" array.',
      );
    }
    return rowsToMessages(rows, options, 'json');
  }
}

/** CSV/TSV with a header row. Column names are matched case-insensitively. */
export class CsvImporter implements MessageImporter {
  readonly format = 'csv';

  supports(format: string, fileName?: string): boolean {
    return format === 'csv' || (fileName ?? '').toLowerCase().endsWith('.csv');
  }

  async import(input: Buffer | string, options: ImportOptions = {}): Promise<ImportOutcome> {
    let rows: Array<Record<string, unknown>>;
    try {
      rows = parseCsv(asText(input), {
        columns: (header: string[]) => header.map((column) => column.trim().toLowerCase()),
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      }) as Array<Record<string, unknown>>;
    } catch (error) {
      throw new MessageImportError(`Could not read this CSV: ${(error as Error).message}`);
    }
    if (rows.length === 0) throw new MessageImportError('This CSV has no data rows.');
    return rowsToMessages(rows, options, 'csv');
  }
}

const FIELD_ALIASES: Record<keyof NormalizedMessage | 'replyTo', string[]> = {
  externalId: ['externalid', 'id', 'message_id', 'messageid'],
  channel: ['channel', 'chat', 'group', 'room', 'conversation'],
  authorName: ['authorname', 'author', 'from', 'sender', 'user', 'name'],
  authorId: ['authorid', 'from_id', 'user_id', 'userid', 'senderid'],
  content: ['content', 'text', 'message', 'body'],
  messageDate: ['messagedate', 'date', 'timestamp', 'time', 'created_at', 'createdat', 'sent_at'],
  replyToExternalId: ['replytoexternalid', 'reply_to', 'replyto', 'reply_to_message_id'],
  replyTo: ['reply_to', 'replyto'],
  isAnnouncement: ['isannouncement', 'announcement'],
  metadata: ['metadata'],
};

function pick(row: Record<string, unknown>, aliases: string[]): unknown {
  for (const [key, value] of Object.entries(row)) {
    if (aliases.includes(key.trim().toLowerCase())) return value;
  }
  return undefined;
}

function rowsToMessages(
  rows: Array<Record<string, unknown>>,
  options: ImportOptions,
  platform: string,
): ImportOutcome {
  const messages: NormalizedMessage[] = [];
  const warnings: string[] = [];

  rows.forEach((row, index) => {
    const content = String(pick(row, FIELD_ALIASES.content) ?? '').trim();
    if (!content) {
      if (warnings.length < MAX_WARNINGS) warnings.push(`Row ${index + 1}: no message text.`);
      return;
    }
    const date = toDate(pick(row, FIELD_ALIASES.messageDate));
    if (!date) {
      if (warnings.length < MAX_WARNINGS) {
        warnings.push(`Row ${index + 1}: missing or unreadable date.`);
      }
      return;
    }
    const channel = String(pick(row, FIELD_ALIASES.channel) ?? options.channel ?? '').trim();
    if (!channel) {
      if (warnings.length < MAX_WARNINGS) {
        warnings.push(`Row ${index + 1}: no channel column and no channel supplied.`);
      }
      return;
    }
    const announcementCell = pick(row, FIELD_ALIASES.isAnnouncement);
    messages.push(
      normalise(
        {
          externalId: optionalString(pick(row, FIELD_ALIASES.externalId)),
          channel,
          authorName: String(pick(row, FIELD_ALIASES.authorName) ?? 'Unknown'),
          authorId: optionalString(pick(row, FIELD_ALIASES.authorId)),
          content,
          messageDate: date,
          replyToExternalId: optionalString(pick(row, FIELD_ALIASES.replyToExternalId)),
          ...(announcementCell !== undefined
            ? { isAnnouncement: /^(1|true|yes|y)$/i.test(String(announcementCell)) }
            : {}),
          metadata: { platform },
        },
        options,
      ),
    );
  });

  if (messages.length === 0) {
    throw new MessageImportError(
      `No usable messages were found. ${warnings[0] ?? 'Check the column names.'}`,
    );
  }
  return { messages, warnings };
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/**
 * Plain-text chat logs in the widely used
 * `[DD/MM/YYYY, HH:MM] Author: message` shape (WhatsApp and similar exports).
 * Continuation lines are appended to the previous message.
 */
export class TxtImporter implements MessageImporter {
  readonly format = 'txt';

  supports(format: string, fileName?: string): boolean {
    return format === 'txt' || (fileName ?? '').toLowerCase().endsWith('.txt');
  }

  async import(input: Buffer | string, options: ImportOptions = {}): Promise<ImportOutcome> {
    const channel = options.channel;
    if (!channel) {
      throw new MessageImportError('A channel name is required when importing a plain-text log.');
    }

    const linePattern =
      /^\[?(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}(?:,)?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)\]?\s*[-–]?\s*([^:]{1,80}?):\s?([\s\S]*)$/;

    const messages: NormalizedMessage[] = [];
    const warnings: string[] = [];

    for (const rawLine of asText(input).replace(/\r\n?/g, '\n').split('\n')) {
      const line = rawLine.trimEnd();
      if (!line.trim()) continue;
      const match = linePattern.exec(line);
      if (match) {
        const date = toDate(normaliseDateString(match[1] as string));
        if (!date) {
          if (warnings.length < MAX_WARNINGS) warnings.push(`Unreadable timestamp: ${match[1]}`);
          continue;
        }
        messages.push(
          normalise(
            {
              channel,
              authorName: (match[2] ?? 'Unknown').trim(),
              content: match[3] ?? '',
              messageDate: date,
              metadata: { platform: 'txt' },
            },
            options,
          ),
        );
      } else if (messages.length > 0) {
        const previous = messages[messages.length - 1] as NormalizedMessage;
        previous.content = `${previous.content}\n${line}`.trim();
      }
    }

    if (messages.length === 0) {
      throw new MessageImportError(
        'No messages matched the expected "[date, time] Author: message" format.',
      );
    }
    return { messages, warnings };
  }
}

/** Converts `DD/MM/YYYY, HH:MM` into something `Date` parses unambiguously. */
function normaliseDateString(value: string): string {
  const match = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4}),?\s+(.*)$/.exec(value.trim());
  if (!match) return value;
  const [, a, b, c, time] = match as unknown as [string, string, string, string, string];
  // A four-digit first component is already ISO-ordered.
  if (a.length === 4) return `${a}-${b.padStart(2, '0')}-${c.padStart(2, '0')}T${to24h(time)}`;
  const year = c.length === 2 ? `20${c}` : c;
  // `12/09/2026` is genuinely ambiguous. Resolve it where the numbers decide
  // (a value above 12 can only be a day), and otherwise assume day-first, the
  // dominant convention in these exports.
  const first = Number.parseInt(a, 10);
  const second = Number.parseInt(b, 10);
  const monthFirst = second > 12 && first <= 12;
  const day = monthFirst ? b : a;
  const month = monthFirst ? a : b;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${to24h(time)}`;
}

function to24h(time: string): string {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/.exec(time.trim());
  if (!match) return '00:00:00';
  let hours = Number.parseInt(match[1] as string, 10);
  const minutes = match[2] as string;
  const seconds = match[3] ?? '00';
  const meridiem = match[4]?.toLowerCase();
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${minutes}:${seconds}`;
}

export const MESSAGE_IMPORTERS: MessageImporter[] = [
  new TelegramImporter(),
  new JsonImporter(),
  new CsvImporter(),
  new TxtImporter(),
];

export function resolveImporter(format: string, fileName?: string): MessageImporter {
  const importer = MESSAGE_IMPORTERS.find((candidate) => candidate.supports(format, fileName));
  if (!importer) {
    throw new MessageImportError(
      `No importer handles format "${format}". Supported: telegram, json, csv, txt.`,
    );
  }
  return importer;
}
