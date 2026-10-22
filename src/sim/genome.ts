import { BRAIN_WEIGHT_COUNT, WEIGHT_LIMIT } from './brain';
import {
  DEFAULT_STRUCTURE,
  crossoverPayload,
  isValidPayload,
  mutatePayload,
  payloadDifference,
  payloadLength,
  randomPayload,
  type BrainContext,
  type BrainKind,
} from './brains';
import { clamp } from './math';
import { InnovationRegistry } from './neat';
import type { Rng } from './rng';

export { WEIGHT_LIMIT };

/** Decoded body traits, in real units (tiles, radians, ticks). */
export interface Traits {
  size: number;
  /** Top speed in tiles per tick. */
  maxSpeed: number;
  /** How far the creature sees, in tiles. */
  visionRange: number;
  /** Width of the field of view, in radians. */
  visionFov: number;
  /** Body colour hue, 0-1. */
  hue: number;
  /** Chance that each gene changes when this creature reproduces. */
  mutationRate: number;
  /** Fraction of max energy the creature must hold before it will reproduce. */
  reproThreshold: number;
  /** 0 digests only plants, 1 only meat. In between, both badly. */
  diet: number;
}

interface TraitSpec {
  min: number;
  max: number;
}

const TRAIT_SPECS: Record<keyof Traits, TraitSpec> = {
  size: { min: 0.5, max: 2 },
  maxSpeed: { min: 0.05, max: 0.4 },
  visionRange: { min: 2, max: 10 },
  visionFov: { min: 0.6, max: 4 },
  hue: { min: 0, max: 1 },
  mutationRate: { min: 0.01, max: 0.15 },
  reproThreshold: { min: 0.5, max: 1 },
  diet: { min: 0, max: 1 },
};

/** Gene order. Each trait gene is stored normalised to [0, 1]. */
export const TRAIT_ORDER = Object.keys(TRAIT_SPECS) as (keyof Traits)[];
export const TRAIT_COUNT = TRAIT_ORDER.length;
/** The smallest and largest real value a trait can take. */
export function traitRange(name: keyof Traits): { min: number; max: number } {
  return TRAIT_SPECS[name];
}

export const MAX_VISION_RANGE = TRAIT_SPECS.visionRange.max;

/** What mutation needs to know for the default brain kind, which has no structure to change. */
const DEFAULT_CONTEXT: BrainContext = {
  kind: 'mlp',
  innovations: new InnovationRegistry(),
  structure: DEFAULT_STRUCTURE,
};

/**
 * A genome is a flat float array: trait genes first, then the brain's genes. For
 * the default feed-forward brain that is every weight, and the length is fixed;
 * for NEAT brains the brain part is a list of connections and the length varies.
 */
export const GENOME_LENGTH = TRAIT_COUNT + BRAIN_WEIGHT_COUNT;

/** The length of a genome for a fixed-size brain kind, or null for NEAT. */
export function genomeLength(kind: BrainKind): number | null {
  const brain = payloadLength(kind);
  return brain === null ? null : TRAIT_COUNT + brain;
}

/** Is this a usable genome for the brain kind? */
export function isValidGenome(genome: Float32Array, kind: BrainKind): boolean {
  return genome.length > TRAIT_COUNT && isValidPayload(kind, genome.subarray(TRAIT_COUNT));
}

export function randomGenome(
  rng: Rng,
  kind: BrainKind = 'mlp',
  innovations?: InnovationRegistry,
): Float32Array {
  const traits = new Float32Array(TRAIT_COUNT);
  for (let i = 0; i < TRAIT_COUNT; i++) traits[i] = rng.next();
  // Founders are mostly plant eaters; meat eating has to evolve.
  const diet = TRAIT_ORDER.indexOf('diet');
  traits[diet] = traits[diet] ** 3;
  const brain = randomPayload(kind, rng, innovations as InnovationRegistry);
  const genome = new Float32Array(TRAIT_COUNT + brain.length);
  genome.set(traits);
  genome.set(brain, TRAIT_COUNT);
  return genome;
}

export function decodeTraits(genome: Float32Array): Traits {
  const traits = {} as Traits;
  TRAIT_ORDER.forEach((name, i) => {
    const { min, max } = TRAIT_SPECS[name];
    traits[name] = min + (max - min) * clamp(genome[i], 0, 1);
  });
  return traits;
}

/** The brain part of a genome, as a view (no copy). */
export function brainWeights(genome: Float32Array): Float32Array {
  return genome.subarray(TRAIT_COUNT);
}

/**
 * A child genome: a copy of the parent with random changes. Each gene changes with
 * the parent's own mutation rate (itself a gene, so it can evolve) by a Gaussian step.
 * Pass `context` for brains that are not the default kind.
 */
export function mutate(
  parent: Float32Array,
  rng: Rng,
  magnitude: number,
  rateMultiplier: number,
  context?: BrainContext,
): Float32Array {
  const rate = decodeTraits(parent).mutationRate * rateMultiplier;
  const traits = Float32Array.from(parent.subarray(0, TRAIT_COUNT));
  for (let i = 0; i < TRAIT_COUNT; i++) {
    if (rng.next() >= rate) continue;
    traits[i] = clamp(traits[i] + rng.gaussian(0, magnitude), 0, 1);
  }
  const brain = mutatePayload(
    parent.subarray(TRAIT_COUNT),
    rng,
    magnitude,
    rate,
    rateMultiplier,
    context ?? DEFAULT_CONTEXT,
  );
  const child = new Float32Array(TRAIT_COUNT + brain.length);
  child.set(traits);
  child.set(brain, TRAIT_COUNT);
  return child;
}

/** A child genome that takes each gene from one parent or the other, at random. */
export function crossover(
  a: Float32Array,
  b: Float32Array,
  rng: Rng,
  kind: BrainKind = 'mlp',
): Float32Array {
  const traits = new Float32Array(TRAIT_COUNT);
  for (let i = 0; i < TRAIT_COUNT; i++) traits[i] = rng.next() < 0.5 ? a[i] : b[i];
  const brain = crossoverPayload(kind, a.subarray(TRAIT_COUNT), b.subarray(TRAIT_COUNT), rng);
  const child = new Float32Array(TRAIT_COUNT + brain.length);
  child.set(traits);
  child.set(brain, TRAIT_COUNT);
  return child;
}

/**
 * How different two genomes are, from 0 (identical): the mean squared difference
 * of the body traits and of the brain genes, averaged, then square-rooted.
 */
export function genomeDifference(
  a: Float32Array,
  b: Float32Array,
  kind: BrainKind = 'mlp',
): number {
  let traitSum = 0;
  for (let i = 0; i < TRAIT_COUNT; i++) {
    const d = a[i] - b[i];
    traitSum += d * d;
  }
  const brain = payloadDifference(kind, a.subarray(TRAIT_COUNT), b.subarray(TRAIT_COUNT));
  return Math.sqrt((traitSum / TRAIT_COUNT + brain) / 2);
}

/** Set the diet gene of a genome to a real diet value between 0 and 1. */
export function setDiet(genome: Float32Array, diet: number): void {
  genome[TRAIT_ORDER.indexOf('diet')] = clamp(diet, 0, 1);
}
