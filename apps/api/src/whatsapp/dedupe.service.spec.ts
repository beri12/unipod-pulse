import { DedupeService } from './dedupe.service.js';

describe('DedupeService', () => {
  it('accepts an id once and rejects repeats', () => {
    const dedupe = new DedupeService();

    expect(dedupe.markIfNew('wamid.ABC')).toBe(true);
    expect(dedupe.markIfNew('wamid.ABC')).toBe(false);
    expect(dedupe.markIfNew('wamid.ABC')).toBe(false);
  });

  it('treats different ids independently', () => {
    const dedupe = new DedupeService();

    expect(dedupe.markIfNew('wamid.A')).toBe(true);
    expect(dedupe.markIfNew('wamid.B')).toBe(true);
  });

  it('forgets an id once its TTL has passed', () => {
    const dedupe = new DedupeService(1000);
    const start = 1_000_000;

    expect(dedupe.markIfNew('wamid.A', start)).toBe(true);
    expect(dedupe.markIfNew('wamid.A', start + 500)).toBe(false);
    expect(dedupe.markIfNew('wamid.A', start + 1500)).toBe(true);
  });
});
