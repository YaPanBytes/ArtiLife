import { describe, expect, it } from 'vitest';
import {
  GENOME_LENGTH,
  TRAIT_COUNT,
  TRAIT_ORDER,
  WEIGHT_LIMIT,
  mutate,
  randomGenome,
} from '../src/sim/genome';
import { Rng } from '../src/sim/rng';

const count = (a: Float32Array, b: Float32Array) => a.filter((v, i) => v !== b[i]).length;

describe('mutate', () => {
  const parent = randomGenome(new Rng(1));

  it('returns a copy and leaves the parent untouched', () => {
    const before = Float32Array.from(parent);
    const child = mutate(parent, new Rng(2), 0.1, 1);
    expect(child).not.toBe(parent);
    expect(child.length).toBe(GENOME_LENGTH);
    expect(parent).toEqual(before);
  });

  it('is deterministic for a given generator state', () => {
    expect(mutate(parent, new Rng(3), 0.1, 1)).toEqual(mutate(parent, new Rng(3), 0.1, 1));
    expect(mutate(parent, new Rng(3), 0.1, 1)).not.toEqual(mutate(parent, new Rng(4), 0.1, 1));
  });

  it('makes no changes when the rate multiplier or magnitude is 0', () => {
    expect(mutate(parent, new Rng(5), 0.1, 0)).toEqual(parent);
    expect(mutate(parent, new Rng(5), 0, 1)).toEqual(parent);
  });

  it('changes about mutationRate of the genes on average', () => {
    const rng = new Rng(6);
    const g = new Float32Array(GENOME_LENGTH).fill(0.3);
    g[TRAIT_ORDER.indexOf('mutationRate')] = (0.1 - 0.01) / (0.15 - 0.01); // mutation rate 0.1
    let changed = 0;
    const trials = 200;
    for (let i = 0; i < trials; i++) changed += count(mutate(g, rng, 0.1, 1), g);
    expect(changed / trials / GENOME_LENGTH).toBeCloseTo(0.1, 1);
  });

  it('scales with the rate multiplier', () => {
    const rng = new Rng(7);
    let low = 0;
    let high = 0;
    for (let i = 0; i < 100; i++) {
      low += count(mutate(parent, rng, 0.1, 0.5), parent);
      high += count(mutate(parent, rng, 0.1, 2), parent);
    }
    expect(high).toBeGreaterThan(low * 2);
  });

  it('keeps trait genes in [0, 1] and brain weights within the limit, even after many generations', () => {
    const rng = new Rng(8);
    let g = parent;
    for (let i = 0; i < 300; i++) g = mutate(g, rng, 1, 5);
    for (let i = 0; i < TRAIT_COUNT; i++) {
      expect(g[i]).toBeGreaterThanOrEqual(0);
      expect(g[i]).toBeLessThanOrEqual(1);
    }
    for (let i = TRAIT_COUNT; i < g.length; i++)
      expect(Math.abs(g[i])).toBeLessThanOrEqual(WEIGHT_LIMIT);
  });

  it('makes steps of roughly the requested size', () => {
    const rng = new Rng(9);
    const g = new Float32Array(GENOME_LENGTH);
    g.fill(0, TRAIT_COUNT);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 100; i++) {
      const c = mutate(g, rng, 0.2, 10);
      for (let j = TRAIT_COUNT; j < c.length; j++)
        if (c[j] !== 0) {
          sum += c[j] * c[j];
          n++;
        }
    }
    expect(Math.sqrt(sum / n)).toBeCloseTo(0.2, 1);
  });
});
