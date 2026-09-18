import { isGreeting } from './greetings.js';

describe('isGreeting', () => {
  it.each(['hello', 'HELLO', 'Hi', 'hey', 'salam', 'bonjour', 'hola', 'مرحبا', 'start'])(
    'recognises "%s"',
    (word) => {
      expect(isGreeting(word)).toBe(true);
    },
  );

  it('ignores trailing punctuation', () => {
    expect(isGreeting('salam!!!')).toBe(true);
    expect(isGreeting('hello?')).toBe(true);
    expect(isGreeting('hi.')).toBe(true);
  });

  it('rejects anything that is not a greeting', () => {
    expect(isGreeting('banana')).toBe(false);
    expect(isGreeting('helloworld')).toBe(false);
    expect(isGreeting('')).toBe(false);
    expect(isGreeting('!!!')).toBe(false);
  });
});
