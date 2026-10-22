import {
  Brain,
  BRAIN_WEIGHT_COUNT,
  RECURRENT_WEIGHT_COUNT,
  WEIGHT_LIMIT,
  initBrainWeights,
} from './brain';
import { clamp } from './math';
import {
  InnovationRegistry,
  NeatBrain,
  crossoverNeat,
  isValidNeat,
  mutateNeat,
  neatDifference,
  randomNeat,
} from './neat';
import type { Rng } from './rng';

export type BrainKind = 'mlp' | 'recurrent' | 'neat';

export const BRAIN_KINDS: readonly BrainKind[] = ['mlp', 'recurrent', 'neat'];

/** What every kind of brain offers the rest of the simulation. */
export interface BrainLike {
  /** Hidden neuron values from the latest `think`, for display. */
  readonly hidden: Float32Array;
  /** How many connections the brain has: what it costs to run. */
  readonly connectionCount: number;
  think(inputs: Float32Array, outputs: Float32Array): void;
  /** Adapt to a reward during life. Changes are never inherited. */
  learn(reward: number, rate: number, forgetting: number): void;
  /** The weights as adapted by learning, or null if this brain has never learned. */
  liveWeights(): Float32Array | null;
  setLiveWeights(weights: Float32Array): void;
  /** What the brain carries from one tick to the next (hidden activations), or null if it carries nothing. */
  getState(): Float32Array | null;
  setState(state: Float32Array): void;
}

/** How structural mutation is tuned (NEAT only). */
export interface StructureSettings {
  addConnection: number;
  addNode: number;
  maxHidden: number;
  maxConnections: number;
}

/** Everything a brain-aware mutation or crossover needs to know. */
export interface BrainContext {
  kind: BrainKind;
  innovations: InnovationRegistry;
  structure: StructureSettings;
}

export const DEFAULT_STRUCTURE: StructureSettings = {
  addConnection: 0.08,
  addNode: 0.04,
  maxHidden: 24,
  maxConnections: 700,
};

/** Genes in the brain part of a genome of a fixed-size kind, or null when the size varies. */
export function payloadLength(kind: BrainKind): number | null {
  if (kind === 'mlp') return BRAIN_WEIGHT_COUNT;
  if (kind === 'recurrent') return RECURRENT_WEIGHT_COUNT;
  return null;
}

/** Is this a usable brain part for the kind? */
export function isValidPayload(kind: BrainKind, payload: Float32Array): boolean {
  const length = payloadLength(kind);
  return length === null ? isValidNeat(payload) : payload.length === length;
}

export function randomPayload(
  kind: BrainKind,
  rng: Rng,
  innovations: InnovationRegistry,
): Float32Array {
  if (kind === 'neat') return randomNeat(rng, innovations);
  const weights = new Float32Array(payloadLength(kind)!);
  initBrainWeights(rng, weights, kind === 'recurrent');
  return weights;
}

export function createBrain(kind: BrainKind, payload: Float32Array): BrainLike {
  if (kind === 'neat') return new NeatBrain(payload);
  return new Brain(payload, kind === 'recurrent');
}

/**
 * A mutated copy of a brain's genes. Fixed-size brains change weights; NEAT
 * brains also change shape. `rate` is the chance each gene changes.
 */
export function mutatePayload(
  payload: Float32Array,
  rng: Rng,
  magnitude: number,
  rate: number,
  rateMultiplier: number,
  context: BrainContext,
): Float32Array {
  if (context.kind === 'neat') {
    const s = context.structure;
    return mutateNeat(
      payload,
      rng,
      {
        weightRate: rate,
        magnitude,
        addConnection: s.addConnection * rateMultiplier,
        addNode: s.addNode * rateMultiplier,
        maxHidden: s.maxHidden,
        maxConnections: s.maxConnections,
      },
      context.innovations,
    );
  }
  const child = Float32Array.from(payload);
  for (let i = 0; i < child.length; i++) {
    if (rng.next() >= rate) continue;
    child[i] = clamp(child[i] + rng.gaussian(0, magnitude), -WEIGHT_LIMIT, WEIGHT_LIMIT);
  }
  return child;
}

export function crossoverPayload(
  kind: BrainKind,
  a: Float32Array,
  b: Float32Array,
  rng: Rng,
): Float32Array {
  if (kind === 'neat') return crossoverNeat(a, b, rng);
  const child = new Float32Array(a.length);
  for (let i = 0; i < child.length; i++) child[i] = rng.next() < 0.5 ? a[i] : b[i];
  return child;
}

/** The mean squared difference between two brains' genes. */
export function payloadDifference(kind: BrainKind, a: Float32Array, b: Float32Array): number {
  if (kind === 'neat') {
    const { sum, count } = neatDifference(a, b);
    return count === 0 ? 0 : sum / count;
  }
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return n === 0 ? 0 : sum / n;
}
