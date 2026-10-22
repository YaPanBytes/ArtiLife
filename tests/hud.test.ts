import { describe, expect, it } from 'vitest';
import { HEART_COUNT, formatCount, heartsFor, seasonInfo } from '../src/render/hud';
import { resolveConfig } from '../src/sim/config';

const count = (hearts: string[], kind: string) => hearts.filter((h) => h === kind).length;

describe('heartsFor', () => {
  it('always returns ten hearts', () => {
    for (const f of [-1, 0, 0.01, 0.5, 1, 3]) expect(heartsFor(f).length).toBe(HEART_COUNT);
  });

  it('is empty at 0 and full at 1', () => {
    expect(count(heartsFor(0), 'empty')).toBe(10);
    expect(count(heartsFor(1), 'full')).toBe(10);
    expect(count(heartsFor(5), 'full')).toBe(10);
  });

  it('fills left to right in half-heart steps', () => {
    expect(
      heartsFor(0.5)
        .slice(0, 5)
        .every((h) => h === 'full'),
    ).toBe(true);
    expect(
      heartsFor(0.5)
        .slice(5)
        .every((h) => h === 'empty'),
    ).toBe(true);
    const h = heartsFor(0.35);
    expect(count(h, 'full')).toBe(3);
    expect(count(h, 'half')).toBe(1);
    expect(h[3]).toBe('half');
  });

  it('shows a living creature with almost no energy as half a heart, not zero', () => {
    const h = heartsFor(0.001);
    expect(h[0]).toBe('half');
    expect(count(h, 'full')).toBe(0);
  });
});

describe('formatCount', () => {
  it('pads with zeros and caps at the widest value that fits', () => {
    expect(formatCount(7, 4)).toBe('0007');
    expect(formatCount(1234, 4)).toBe('1234');
    expect(formatCount(99999, 4)).toBe('9999');
    expect(formatCount(-3, 4)).toBe('0000');
    expect(formatCount(12.9, 3)).toBe('012');
  });
});

describe('seasonInfo', () => {
  const cfg = (enabled: boolean) =>
    resolveConfig({ food: { seasons: { enabled, lengthTicks: 400 } } });

  it('is null when seasons are off', () => {
    expect(seasonInfo(100, cfg(false))).toBeNull();
  });

  it('walks through the four seasons and counts years from 1', () => {
    const c = cfg(true);
    expect(seasonInfo(0, c)).toEqual({ year: 1, name: 'SPRING' });
    expect(seasonInfo(100, c)).toEqual({ year: 1, name: 'SUMMER' });
    expect(seasonInfo(250, c)).toEqual({ year: 1, name: 'AUTUMN' });
    expect(seasonInfo(399, c)).toEqual({ year: 1, name: 'WINTER' });
    expect(seasonInfo(400, c)).toEqual({ year: 2, name: 'SPRING' });
  });
});
