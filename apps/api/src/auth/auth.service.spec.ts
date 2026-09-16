import { describe, expect, it } from 'vitest';
import { parseDuration, toPublicUser } from './auth.service';

describe('parseDuration', () => {
  it.each([
    ['15m', 15 * 60_000],
    ['7d', 7 * 86_400_000],
    ['2h', 2 * 3_600_000],
    ['30s', 30_000],
    ['3600', 3_600_000],
  ])('parses %s', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it('falls back to 15 minutes for an unparseable value', () => {
    expect(parseDuration('whenever')).toBe(15 * 60_000);
  });
});

describe('toPublicUser', () => {
  it('never exposes the password hash', () => {
    const user = {
      id: 'u1',
      email: 'ada@unipods.dev',
      name: 'Ada',
      avatarUrl: null,
      role: 'ADMIN' as const,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      passwordHash: 'super-secret-hash',
    };
    const result = toPublicUser(user);
    expect(JSON.stringify(result)).not.toContain('super-secret-hash');
    expect(result).toEqual({
      id: 'u1',
      email: 'ada@unipods.dev',
      name: 'Ada',
      avatarUrl: null,
      role: 'ADMIN',
      createdAt: '2026-09-01T00:00:00.000Z',
    });
  });
});
