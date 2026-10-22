import { describe, expect, it } from 'vitest';
import {
  BRAIN_LAYOUT,
  BRAIN_WEIGHT_COUNT,
  Brain,
  HIDDEN_SIZE,
  INPUT_COUNT,
  OUTPUT_COUNT,
  OUT_THRUST,
  OUT_TURN,
} from '../src/sim/brain';
import {
  GENOME_LENGTH,
  TRAIT_COUNT,
  brainWeights,
  decodeTraits,
  randomGenome,
} from '../src/sim/genome';
import { Rng } from '../src/sim/rng';

describe('genome', () => {
  it('has trait genes followed by all brain weights', () => {
    expect(GENOME_LENGTH).toBe(TRAIT_COUNT + BRAIN_WEIGHT_COUNT);
    expect(randomGenome(new Rng(1)).length).toBe(GENOME_LENGTH);
  });

  it('is deterministic for a seed and finite everywhere', () => {
    const a = randomGenome(new Rng(5));
    const b = randomGenome(new Rng(5));
    expect(a).toEqual(b);
    expect(a.every(Number.isFinite)).toBe(true);
    expect(randomGenome(new Rng(6))).not.toEqual(a);
  });

  it('decodes traits within their ranges', () => {
    const rng = new Rng(2);
    for (let i = 0; i < 50; i++) {
      const t = decodeTraits(randomGenome(rng));
      expect(t.size).toBeGreaterThanOrEqual(0.5);
      expect(t.size).toBeLessThanOrEqual(2);
      expect(t.maxSpeed).toBeGreaterThanOrEqual(0.05);
      expect(t.maxSpeed).toBeLessThanOrEqual(0.4);
      expect(t.visionRange).toBeGreaterThanOrEqual(2);
      expect(t.visionRange).toBeLessThanOrEqual(10);
      expect(t.hue).toBeGreaterThanOrEqual(0);
      expect(t.hue).toBeLessThanOrEqual(1);
    }
  });

  it('decodes the ends of the gene range to the trait min and max, and clamps outside it', () => {
    const g = new Float32Array(GENOME_LENGTH);
    expect(decodeTraits(g).visionRange).toBe(2);
    g.fill(1, 0, TRAIT_COUNT);
    expect(decodeTraits(g).visionRange).toBe(10);
    g.fill(7, 0, TRAIT_COUNT);
    expect(decodeTraits(g).visionRange).toBe(10);
  });

  it('exposes brain weights as a view, not a copy', () => {
    const g = randomGenome(new Rng(3));
    const w = brainWeights(g);
    expect(w.length).toBe(BRAIN_WEIGHT_COUNT);
    w[0] = 123;
    expect(g[TRAIT_COUNT]).toBe(123);
  });
});

describe('Brain', () => {
  const run = (weights: Float32Array, inputs = new Float32Array(INPUT_COUNT)) => {
    const outputs = new Float32Array(OUTPUT_COUNT);
    new Brain(weights).think(inputs, outputs);
    return outputs;
  };

  it('outputs zero for an all-zero brain', () => {
    expect(Array.from(run(new Float32Array(BRAIN_WEIGHT_COUNT)))).toEqual(
      new Array(OUTPUT_COUNT).fill(0),
    );
  });

  it('computes tanh(w2 * tanh(w1 * x + b1) + b2) through the layers', () => {
    const w = new Float32Array(BRAIN_WEIGHT_COUNT);
    // Hidden neuron 0 reads input 0 with weight 2; the turn output reads hidden 0 with weight 0.5.
    w[BRAIN_LAYOUT.W1 + 0 * INPUT_COUNT + 0] = 2;
    w[BRAIN_LAYOUT.W2 + OUT_TURN * HIDDEN_SIZE + 0] = 0.5;
    w[BRAIN_LAYOUT.B2 + OUT_THRUST] = -0.3;
    const inputs = new Float32Array(INPUT_COUNT);
    inputs[0] = 0.4;
    const out = run(w, inputs);
    expect(out[OUT_TURN]).toBeCloseTo(Math.tanh(0.5 * Math.tanh(0.8)), 5);
    expect(out[OUT_THRUST]).toBeCloseTo(Math.tanh(-0.3), 5);
  });

  it('keeps outputs inside (-1, 1) even for huge weights and inputs', () => {
    const w = new Float32Array(BRAIN_WEIGHT_COUNT).fill(50);
    const out = run(w, new Float32Array(INPUT_COUNT).fill(5));
    expect(out.every((v) => v >= -1 && v <= 1)).toBe(true);
  });

  it('rejects a weight array of the wrong size', () => {
    expect(() => new Brain(new Float32Array(3))).toThrow(/weights/);
  });
});
