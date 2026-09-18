import { looksLikeQuestion } from './question.js';

describe('looksLikeQuestion', () => {
  it.each([
    'What are the opening hours?',
    'how much is a desk',
    'Où est le bureau ?',
    'combien coute une place',
    'شحال الثمن؟',
    'فين كاين المكتب',
    'Is there parking?',
    'anyone knows the wifi password',
  ])('accepts "%s"', (text) => {
    expect(looksLikeQuestion(text)).toBe(true);
  });

  it.each([
    'ok',
    'thanks!',
    'see you tomorrow',
    'I will be there at 5',
    'merci beaucoup',
    '👍',
    '',
  ])('rejects "%s"', (text) => {
    expect(looksLikeQuestion(text)).toBe(false);
  });

  it('accepts the Arabic question mark', () => {
    expect(looksLikeQuestion('المكتب مفتوح اليوم؟')).toBe(true);
  });

  it('rejects text that is too short to be a real question', () => {
    expect(looksLikeQuestion('how?')).toBe(false);
  });
});
