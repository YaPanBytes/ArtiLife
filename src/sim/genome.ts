import { BRAIN_WEIGHT_COUNT, initBrainWeights } from './brain';
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
};

/** Gene order. Each trait gene is stored normalised to [0, 1]. */
export const TRAIT_ORDER = Object.keys(TRAIT_SPECS) as (keyof Traits)[];
export const TRAIT_COUNT = TRAIT_ORDER.length;
export const MAX_VISION_RANGE = TRAIT_SPECS.visionRange.max;

/** A genome is a flat float array: trait genes first, then every brain weight. */
export const GENOME_LENGTH = TRAIT_COUNT + BRAIN_WEIGHT_COUNT;

export function randomGenome(rng: Rng): Float32Array {
  const genome = new Float32Array(GENOME_LENGTH);
  for (let i = 0; i < TRAIT_COUNT; i++) genome[i] = rng.next();
  initBrainWeights(rng, genome.subarray(TRAIT_COUNT));
  return genome;
}

export function decodeTraits(genome: Float32Array): Traits {
  const traits = {} as Traits;
  TRAIT_ORDER.forEach((name, i) => {
    const { min, max } = TRAIT_SPECS[name];
    traits[name] = min + (max - min) * Math.min(1, Math.max(0, genome[i]));
  });
  return traits;
}

/** The brain-weight part of a genome, as a view (no copy). */
export function brainWeights(genome: Float32Array): Float32Array {
  return genome.subarray(TRAIT_COUNT);
}
