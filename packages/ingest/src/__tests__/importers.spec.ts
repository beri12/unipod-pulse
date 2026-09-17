import { describe, expect, it } from 'vitest';
import {
  CsvImporter,
  JsonImporter,
  MessageImportError,
  resolveImporter,
  TelegramImporter,
  TxtImporter,
} from '../importers';

describe('resolveImporter', () => {
  it('picks an importer by format and by file name', () => {
    expect(resolveImporter('csv').format).toBe('csv');
    expect(resolveImporter('json', 'result.json').format).toBe('telegram');
  });

  it('refuses an unknown format instead of guessing', () => {
    expect(() => resolveImporter('xlsx')).toThrow(MessageImportError);
  });
});

describe('TelegramImporter', () => {
  const exportFile = JSON.stringify({
    name: 'UniPods',
    chats: {
      list: [
        {
          name: 'announcements',
          messages: [
            {
              id: 42,
              type: 'message',
              date: '2026-09-16T08:30:00',
              date_unixtime: '1789547400',
              from: 'Amara Obi',
              from_id: 'user123',
              text: [
                'Reminder: declarations are due ',
                { type: 'bold', text: 'Thursday' },
                '.',
              ],
            },
            { id: 43, type: 'service', action: 'pin_message' },
            { id: 44, type: 'message', date_unixtime: '1789547500', from: 'Tunde', text: '', reply_to_message_id: 42 },
            { id: 45, type: 'message', date_unixtime: '1789547600', from: 'Tunde', text: 'Understood.', reply_to_message_id: 42 },
          ],
        },
      ],
    },
  });

  it('flattens formatted text and keeps ids, authors and channels', async () => {
    const { messages } = await new TelegramImporter().import(exportFile);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      externalId: '42',
      channel: 'announcements',
      authorName: 'Amara Obi',
      authorId: 'user123',
    });
    expect(messages[0]?.content).toBe('Reminder: declarations are due Thursday.');
  });

  it('skips service entries and empty messages', async () => {
    const { messages } = await new TelegramImporter().import(exportFile);
    expect(messages.map((message) => message.externalId)).toEqual(['42', '45']);
  });

  it('keeps reply relationships for later linking', async () => {
    const { messages } = await new TelegramImporter().import(exportFile);
    expect(messages[1]?.replyToExternalId).toBe('42');
  });

  it('flags a broadcast-sounding message as an announcement', async () => {
    const { messages } = await new TelegramImporter().import(exportFile);
    expect(messages[0]?.isAnnouncement).toBe(true);
    expect(messages[1]?.isAnnouncement).toBe(false);
  });

  it('rejects a file that is not a Telegram export', async () => {
    await expect(new TelegramImporter().import('not json')).rejects.toThrow(MessageImportError);
    await expect(new TelegramImporter().import('{"chats":{"list":[]}}')).rejects.toThrow(
      /No messages were found/,
    );
  });
});

describe('JsonImporter', () => {
  it('accepts an array and an object with a messages key', async () => {
    const rows = [
      { id: '1', channel: 'general', author: 'Ngozi', date: '2026-09-16T09:00:00Z', text: 'Hello' },
    ];
    const fromArray = await new JsonImporter().import(JSON.stringify(rows));
    const fromObject = await new JsonImporter().import(JSON.stringify({ messages: rows }));
    expect(fromArray.messages).toHaveLength(1);
    expect(fromObject.messages[0]?.authorName).toBe('Ngozi');
  });

  it('reports rows it had to skip rather than dropping them silently', async () => {
    const { messages, warnings } = await new JsonImporter().import(
      JSON.stringify([
        { channel: 'general', author: 'A', date: '2026-09-16T09:00:00Z', text: 'Kept' },
        { channel: 'general', author: 'B', date: 'not a date', text: 'Dropped' },
        { channel: 'general', author: 'C', date: '2026-09-16T09:00:00Z', text: '' },
      ]),
    );
    expect(messages).toHaveLength(1);
    expect(warnings).toHaveLength(2);
    expect(warnings.join(' ')).toMatch(/date|text/i);
  });

  it('accepts unix timestamps in seconds and milliseconds', async () => {
    const { messages } = await new JsonImporter().import(
      JSON.stringify([
        { channel: 'c', author: 'A', date: 1789547400, text: 'seconds' },
        { channel: 'c', author: 'A', date: 1789547400000, text: 'milliseconds' },
      ]),
    );
    expect(messages[0]?.messageDate.getTime()).toBe(messages[1]?.messageDate.getTime());
  });
});

describe('CsvImporter', () => {
  it('maps header aliases case-insensitively', async () => {
    const csv = [
      'Message_ID,Chat,Sender,Timestamp,Body',
      '7,build-help,Kelechi,2026-09-16T11:22:00Z,"We use pgvector, locally"',
    ].join('\n');
    const { messages } = await new CsvImporter().import(csv);
    expect(messages[0]).toMatchObject({
      externalId: '7',
      channel: 'build-help',
      authorName: 'Kelechi',
      content: 'We use pgvector, locally',
    });
  });

  it('falls back to the supplied channel when there is no channel column', async () => {
    const csv = 'author,date,text\nNgozi,2026-09-16T09:00:00Z,Hello there';
    const { messages } = await new CsvImporter().import(csv, { channel: 'general' });
    expect(messages[0]?.channel).toBe('general');
  });

  it('explains the failure when no channel can be determined', async () => {
    const csv = 'author,date,text\nNgozi,2026-09-16T09:00:00Z,Hello there';
    await expect(new CsvImporter().import(csv)).rejects.toThrow(/channel/i);
  });
});

describe('TxtImporter', () => {
  it('reads a WhatsApp-style log and joins continuation lines', async () => {
    const log = [
      '[16/09/2026, 09:05] Amara Obi: Declarations are due Thursday.',
      'Please do not leave it late.',
      '[16/09/2026, 09:07] Tunde: Understood.',
    ].join('\n');
    const { messages } = await new TxtImporter().import(log, { channel: 'general' });
    expect(messages).toHaveLength(2);
    expect(messages[0]?.content).toContain('do not leave it late');
    expect(messages[0]?.messageDate.getUTCMonth()).toBe(8);
    expect(messages[0]?.messageDate.getUTCDate()).toBe(16);
  });

  it('requires a channel, because the file does not carry one', async () => {
    await expect(new TxtImporter().import('[16/09/2026, 09:05] A: hi')).rejects.toThrow(/channel/i);
  });

  it('refuses a file where no line matches the expected shape', async () => {
    await expect(
      new TxtImporter().import('just some prose', { channel: 'general' }),
    ).rejects.toThrow(/format/i);
  });

  it('skips the chat app\'s own system lines', async () => {
    const log = [
      '[17/09/2026, 09:00] Amina: Rehearsal moved to Thursday 14:00.',
      '[17/09/2026, 09:01] Bekele: <Media omitted>',
      '[17/09/2026, 09:02] Amina: Messages and calls are end-to-end encrypted.',
      '[17/09/2026, 09:03] Chala: Noted, thanks.',
      '[17/09/2026, 09:04] Amina: This message was deleted',
    ].join('\n');

    const outcome = await new TxtImporter().import(log, { channel: 'Pulse Group' });

    expect(outcome.messages).toHaveLength(2);
    expect(outcome.messages.map((message) => message.content)).toEqual([
      'Rehearsal moved to Thursday 14:00.',
      'Noted, thanks.',
    ]);
  });

  it('drops the chat app\'s unattributed notices instead of gluing them to the message above', async () => {
    const log = [
      '17/09/2026, 08:02 - Messages and calls are end-to-end encrypted.',
      '17/09/2026, 08:02 - Amara created group "Cohort 7"',
      '17/09/2026, 08:03 - Amara added Bekele',
      '17/09/2026, 09:00 - Amara: The venue moved to the Innovation Hall.',
      '17/09/2026, 09:01 - Bekele: Noted.',
      '18/09/2026, 07:55 - Fatima left',
    ].join('\n');

    const { messages } = await new TxtImporter().import(log, { channel: 'Cohort 7' });

    expect(messages).toHaveLength(2);
    // The notices carry a timestamp, so they are new entries in the log, never
    // a continuation — the last message must not have "Fatima left" appended.
    expect(messages[1]?.content).toBe('Noted.');
    expect(messages.some((message) => /created group|added|left|encrypted/.test(message.content))).toBe(
      false,
    );
  });

  it('still stitches genuine continuation lines back together', async () => {
    const log = [
      '17/09/2026, 09:00 - Amara: The rubric is:',
      '40 points for impact',
      '30 for technical execution',
    ].join('\n');

    const { messages } = await new TxtImporter().import(log, { channel: 'Cohort 7' });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe(
      'The rubric is:\n40 points for impact\n30 for technical execution',
    );
  });
});
