import { BRAIN_WEIGHT_COUNT, initBrainWeights } from './brain';
import { clamp } from './math';
import type { Rng } from './rng';

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

/** Brain weights are kept within this range so mutation can't make them run away. */
export const WEIGHT_LIMIT = 4;

/** Gene order. Each trait gene is stored normalised to [0, 1]. */
export const TRAIT_ORDER = Object.keys(TRAIT_SPECS) as (keyof Traits)[];
export const TRAIT_COUNT = TRAIT_ORDER.length;
/** The smallest and largest real value a trait can take. */
export function traitRange(name: keyof Traits): { min: number; max: number } {
  return TRAIT_SPECS[name];
}

export const MAX_VISION_RANGE = TRAIT_SPECS.visionRange.max;

/** A genome is a flat float array: trait genes first, then every brain weight. */
export const GENOME_LENGTH = TRAIT_COUNT + BRAIN_WEIGHT_COUNT;

export function randomGenome(rng: Rng): Float32Array {
  const genome = new Float32Array(GENOME_LENGTH);
  for (let i = 0; i < TRAIT_COUNT; i++) genome[i] = rng.next();
  // Founders are mostly plant eaters; meat eating has to evolve.
  const diet = TRAIT_ORDER.indexOf('diet');
  genome[diet] = genome[diet] ** 3;
  initBrainWeights(rng, genome.subarray(TRAIT_COUNT));
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

/** The brain-weight part of a genome, as a view (no copy). */
export function brainWeights(genome: Float32Array): Float32Array {
  return genome.subarray(TRAIT_COUNT);
}

/**
 * A child genome: a copy of the parent with random changes. Each gene changes with
 * the parent's own mutation rate (itself a gene, so it can evolve) by a Gaussian step.
 */
export function mutate(
  parent: Float32Array,
  rng: Rng,
  magnitude: number,
  rateMultiplier: number,
): Float32Array {
  const child = Float32Array.from(parent);
  const rate = decodeTraits(parent).mutationRate * rateMultiplier;
  for (let i = 0; i < child.length; i++) {
    if (rng.next() >= rate) continue;
    child[i] += rng.gaussian(0, magnitude);
    child[i] =
      i < TRAIT_COUNT ? clamp(child[i], 0, 1) : clamp(child[i], -WEIGHT_LIMIT, WEIGHT_LIMIT);
  }
  return child;
}
