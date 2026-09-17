import { describe, expect, it } from 'vitest';
import { describeLocation, formatReply } from './bot-answer.service';
import { parseAddressedQuestion } from './telegram.parse';

const inGroup = { botUsername: 'pulsebot', chatType: 'supergroup', replyToBot: false };

describe('parseAddressedQuestion', () => {
  it('ignores ordinary group chatter', () => {
    expect(parseAddressedQuestion('anyone bringing snacks tomorrow?', inGroup)).toBeNull();
  });

  it('answers an explicit /ask command', () => {
    expect(parseAddressedQuestion('/ask when is the deadline?', inGroup)).toBe(
      'when is the deadline?',
    );
  });

  it('answers /ask addressed to this bot by name', () => {
    expect(parseAddressedQuestion('/ask@pulsebot when is the deadline?', inGroup)).toBe(
      'when is the deadline?',
    );
  });

  it('treats a bare /ask as a request for help, not a question', () => {
    expect(parseAddressedQuestion('/ask', inGroup)).toBeNull();
  });

  it('leaves other bots their commands', () => {
    expect(parseAddressedQuestion('/poll lunch or dinner', inGroup)).toBeNull();
  });

  it('strips the mention out of the question', () => {
    expect(parseAddressedQuestion('@pulsebot when is the deadline?', inGroup)).toBe(
      'when is the deadline?',
    );
    expect(parseAddressedQuestion('hey @PulseBot what did we decide?', inGroup)).toBe(
      'hey what did we decide?',
    );
  });

  it('does not answer a mention of a different bot', () => {
    expect(parseAddressedQuestion('@otherbot help', inGroup)).toBeNull();
  });

  it('does not answer a bare mention with no question', () => {
    expect(parseAddressedQuestion('@pulsebot', inGroup)).toBeNull();
  });

  it('continues an exchange when someone replies to the bot', () => {
    expect(parseAddressedQuestion('and what about Friday?', { ...inGroup, replyToBot: true })).toBe(
      'and what about Friday?',
    );
  });

  it('treats a direct message as addressed to it', () => {
    expect(
      parseAddressedQuestion('when is the deadline?', { ...inGroup, chatType: 'private' }),
    ).toBe('when is the deadline?');
  });

  it('still works before the bot knows its own username', () => {
    const unknown = { botUsername: null, chatType: 'supergroup', replyToBot: false };
    expect(parseAddressedQuestion('/ask when is the deadline?', unknown)).toBe(
      'when is the deadline?',
    );
    expect(parseAddressedQuestion('@pulsebot when is the deadline?', unknown)).toBeNull();
  });
});

describe('describeLocation', () => {
  it('names a single page', () => {
    expect(describeLocation({ page: 4 })).toBe('page 4');
  });

  it('names a page range only when the chunk spans one', () => {
    expect(describeLocation({ page: 2, pageEnd: 3 })).toBe('pages 2–3');
    expect(describeLocation({ page: 2, pageEnd: 2 })).toBe('page 2');
  });

  it('formats a meeting timestamp as a clock reading', () => {
    expect(describeLocation({ startTime: 1935 })).toBe('at 32:15');
    expect(describeLocation({ startTime: 5 })).toBe('at 0:05');
  });

  it('prefers a page over a section when both exist', () => {
    expect(describeLocation({ page: 1, section: 'Overview' })).toBe('page 1');
  });

  it('returns null when the source has no finer location', () => {
    expect(describeLocation({})).toBeNull();
    expect(describeLocation(null)).toBeNull();
  });
});

describe('formatReply', () => {
  it('appends sources matching the answer markers', () => {
    const reply = formatReply('The deadline is Friday. [1]', [
      { title: 'Hackathon Guidelines', locator: 'page 2' },
    ]);
    expect(reply).toBe('The deadline is Friday. [1]\n\nSources:\n[1] Hackathon Guidelines — page 2');
  });

  it('omits the source list entirely for a refusal', () => {
    const reply = formatReply('I could not find a confirmed answer.', []);
    expect(reply).toBe('I could not find a confirmed answer.');
    expect(reply).not.toContain('Sources');
  });

  it('leaves off the locator when the source has none', () => {
    expect(formatReply('Answer [1]', [{ title: 'Kickoff Meeting', locator: null }])).toContain(
      '[1] Kickoff Meeting',
    );
  });

  it('truncates an answer too long for a chat message', () => {
    const reply = formatReply('x'.repeat(5_000), []);
    expect(reply.length).toBeLessThanOrEqual(3_500);
    expect(reply.endsWith('…')).toBe(true);
  });
});
