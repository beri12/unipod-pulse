import { describe, expect, it } from 'vitest';
import { detectTranscriptFormat, parseTranscript, TranscriptParseError } from '../transcripts';
import { LlmService } from '../services/llm.service';
import { LocalProvider } from '../providers/local.provider';

const VTT = `WEBVTT

00:00:12.000 --> 00:00:18.500
Amara Obi: We agreed to use retrieval-augmented generation.

00:32:15.000 --> 00:32:52.000
Tunde Bello: I will prepare the ingestion pipeline by Friday.
`;

const SRT = `1
00:00:05,000 --> 00:00:09,000
Welcome to the call.

2
00:01:20,500 --> 00:01:25,000
Chidi Nwosu: The deadline moved to Thursday.
`;

describe('transcript parsing', () => {
  it('detects formats from the file name and the content', () => {
    expect(detectTranscriptFormat('meeting.vtt', VTT)).toBe('vtt');
    expect(detectTranscriptFormat('unknown', VTT)).toBe('vtt');
    expect(detectTranscriptFormat('meeting.srt', SRT)).toBe('srt');
    expect(detectTranscriptFormat('x.json', '[]')).toBe('json');
  });

  it('reads WebVTT with speakers and timestamps', () => {
    const parsed = parseTranscript('meeting.vtt', VTT);
    expect(parsed.format).toBe('vtt');
    expect(parsed.segments).toHaveLength(2);
    expect(parsed.segments[0]).toMatchObject({
      speaker: 'Amara Obi',
      startTime: 12,
      endTime: 18.5,
    });
    expect(parsed.segments[1]?.startTime).toBe(1935);
    expect(parsed.durationSeconds).toBe(1972);
  });

  it('reads SubRip, including cues without a speaker', () => {
    const parsed = parseTranscript('meeting.srt', SRT);
    expect(parsed.segments).toHaveLength(2);
    expect(parsed.segments[0]?.speaker).toBeNull();
    expect(parsed.segments[1]?.speaker).toBe('Chidi Nwosu');
    expect(parsed.segments[1]?.startTime).toBe(80.5);
  });

  it('reads JSON transcripts with either key style', () => {
    const json = JSON.stringify({
      segments: [
        { speaker: 'A', text: 'First line', start: 0, end: 4 },
        { speaker: 'B', content: 'Second line', startTime: '00:01:02.500', endTime: 70 },
      ],
    });
    const parsed = parseTranscript('t.json', json);
    expect(parsed.segments).toHaveLength(2);
    expect(parsed.segments[1]?.startTime).toBeCloseTo(62.5);
  });

  it('reads plain text with [mm:ss] markers', () => {
    const parsed = parseTranscript('notes.txt', '[00:10] Amara: We start now.\nContinued on this line.\n[02:00] Done.');
    expect(parsed.segments[0]?.startTime).toBe(10);
    expect(parsed.segments[0]?.content).toContain('Continued on this line');
  });

  it('refuses plain text without timestamps rather than inventing them', () => {
    expect(() => parseTranscript('notes.txt', 'Just some prose with no times.')).toThrow(
      TranscriptParseError,
    );
  });

  it('reports an empty transcript instead of returning nothing', () => {
    expect(() => parseTranscript('empty.vtt', 'WEBVTT\n')).toThrow(TranscriptParseError);
  });

  it('strips cue tags and does not leak markup into content', () => {
    const tagged = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Amara>Hello there</v>\n';
    expect(parseTranscript('x.vtt', tagged).segments[0]?.content).toBe('Hello there');
  });
});

describe('LlmService with a structured provider', () => {
  it('derives a usable conversation title without a model call', async () => {
    const llm = new LlmService(new LocalProvider(1536));
    const title = await llm.generateTitle('When is the team declaration deadline for the hackathon?');
    expect(title.length).toBeGreaterThan(2);
    expect(title).not.toContain('?');
  });

  it('returns an empty catch-up for an empty period', async () => {
    const llm = new LlmService(new LocalProvider(1536));
    const result = await llm.generateCatchUp({ periodLabel: 'today', items: [] });
    expect(result.items ?? result.itemSummaries).toEqual([]);
    expect(result.summary).toContain('Nothing new');
  });

  it('aligns catch-up importance and summaries with the input items', async () => {
    const llm = new LlmService(new LocalProvider(1536));
    const result = await llm.generateCatchUp({
      periodLabel: 'today',
      items: [
        { type: 'announcement', title: 'Deadline', content: 'Declarations are due tomorrow.', occurredAt: null },
        { type: 'discussion', title: 'Chat', content: 'Nice work everyone.', occurredAt: null },
      ],
    });
    expect(result.importance).toHaveLength(2);
    expect(result.itemSummaries).toHaveLength(2);
    expect(result.importance[0]).toBe('high');
    expect(result.importance[1]).toBe('low');
  });
});
