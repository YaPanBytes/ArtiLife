import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng';

describe('Rng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('produces different sequences for different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const same = Array.from({ length: 20 }, () => a.nextU32() === b.nextU32()).filter(Boolean);
    expect(same.length).toBeLessThan(2);
  });

  it('keeps next() in [0, 1) and int(n) in [0, n)', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const f = rng.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = rng.int(5);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(5);
    }
  });

  it('restores the exact sequence from a saved state', () => {
    const rng = new Rng(9);
    for (let i = 0; i < 10; i++) rng.next();
    const state = rng.getState();
    const expected = Array.from({ length: 10 }, () => rng.next());
    rng.setState(state);
    expect(Array.from({ length: 10 }, () => rng.next())).toEqual(expected);
  });

  it('has roughly uniform mean and normal mean/sd', () => {
    const rng = new Rng(123);
    const n = 20000;
    let sum = 0;
    let gSum = 0;
    let gSq = 0;
    for (let i = 0; i < n; i++) {
      sum += rng.next();
      const g = rng.gaussian(2, 3);
      gSum += g;
      gSq += (g - 2) * (g - 2);
    }
    expect(sum / n).toBeCloseTo(0.5, 1);
    expect(gSum / n).toBeCloseTo(2, 0);
    expect(Math.sqrt(gSq / n)).toBeCloseTo(3, 0);
  });

  it('forks independent generators deterministically', () => {
    const a = new Rng(5).fork();
    const b = new Rng(5).fork();
    expect(a.next()).toBe(b.next());
    const parent = new Rng(5);
    const child = parent.fork();
    expect(child.next()).not.toBe(parent.next());
  });
});
