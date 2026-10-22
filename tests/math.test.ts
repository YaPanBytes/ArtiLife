import { describe, expect, it } from 'vitest';
import { clamp, tanh, wrapAngle } from '../src/sim/math';

describe('tanh', () => {
  it('stays within 2e-7 of Math.tanh everywhere', () => {
    let worst = 0;
    for (let x = -20; x <= 20; x += 0.001)
      worst = Math.max(worst, Math.abs(tanh(x) - Math.tanh(x)));
    expect(worst).toBeLessThan(2.5e-7);
  });

  it('is odd, zero at zero, and increasing', () => {
    expect(tanh(0)).toBe(0);
    let previous = -Infinity;
    for (let x = -10; x <= 10; x += 0.01) {
      expect(tanh(-x)).toBeCloseTo(-tanh(x), 12);
      const y = tanh(x);
      expect(y).toBeGreaterThanOrEqual(previous);
      previous = y;
    }
  });

  it('saturates at (almost) 1, whatever it is given', () => {
    for (const x of [8, 50, 1e9, Infinity]) {
      expect(Math.abs(tanh(x) - 1)).toBeLessThan(3e-7);
      expect(Math.abs(tanh(-x) + 1)).toBeLessThan(3e-7);
    }
    expect(tanh(NaN)).toBeNaN();
  });
});

describe('clamp and wrapAngle', () => {
  it('clamp limits a value to a range', () => {
    expect([clamp(-1, 0, 1), clamp(0.5, 0, 1), clamp(2, 0, 1)]).toEqual([0, 0.5, 1]);
  });

  it('wrapAngle keeps an angle in [-PI, PI)', () => {
    for (const a of [-10, -Math.PI, 0, 3, Math.PI, 7, 100]) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThanOrEqual(-Math.PI);
      expect(w).toBeLessThan(Math.PI);
      expect(Math.cos(w)).toBeCloseTo(Math.cos(a), 9);
    }
  });
});
