import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng';
import { SpatialHash } from '../src/sim/spatial-hash';

function bruteForce(
  xs: number[],
  ys: number[],
  w: number,
  h: number,
  x: number,
  y: number,
  r: number,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    let dx = Math.abs(xs[i] - x);
    let dy = Math.abs(ys[i] - y);
    dx = Math.min(dx, w - dx);
    dy = Math.min(dy, h - dy);
    if (dx * dx + dy * dy <= r * r) out.push(i);
  }
  return out;
}

describe('SpatialHash', () => {
  it('matches brute force on random points, including across the wrap seam', () => {
    const rng = new Rng(11);
    const w = 64;
    const h = 48;
    const xs = Array.from({ length: 500 }, () => rng.range(0, w));
    const ys = Array.from({ length: 500 }, () => rng.range(0, h));
    const hash = new SpatialHash(w, h, 6, 4);
    hash.build(xs, ys, xs.length);
    for (let q = 0; q < 200; q++) {
      const x = rng.range(0, w);
      const y = rng.range(0, h);
      const r = rng.range(0.5, 12);
      const got = hash.query(x, y, r).sort((a, b) => a - b);
      expect(got).toEqual(bruteForce(xs, ys, w, h, x, y, r));
    }
  });

  it('returns each item once when the radius exceeds the map', () => {
    const hash = new SpatialHash(20, 20, 5);
    const xs = [1, 10, 19];
    const ys = [1, 10, 19];
    hash.build(xs, ys, 3);
    expect(hash.query(10, 10, 100).sort()).toEqual([0, 1, 2]);
  });

  it('finds neighbours on both sides of the seam', () => {
    const hash = new SpatialHash(32, 32, 4);
    hash.build([0.5, 31.5, 16], [0.5, 31.5, 16], 3);
    expect(hash.query(0, 0, 2).sort()).toEqual([0, 1]);
  });

  it('can be rebuilt with fewer, more or zero items', () => {
    const hash = new SpatialHash(16, 16, 4, 2);
    hash.build([1, 2, 3, 4, 5], [1, 1, 1, 1, 1], 5);
    expect(hash.query(3, 1, 10).length).toBe(5);
    hash.build([1, 2, 3, 4, 5], [1, 1, 1, 1, 1], 2);
    expect(hash.query(3, 1, 10).sort()).toEqual([0, 1]);
    hash.build([], [], 0);
    expect(hash.query(3, 1, 10)).toEqual([]);
  });
});
