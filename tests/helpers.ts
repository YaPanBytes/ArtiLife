import { resolveConfig, type DeepPartial, type SimConfig } from '../src/sim/config';
import { Creature } from '../src/sim/creature';
import { GENOME_LENGTH, TRAIT_ORDER, type Traits } from '../src/sim/genome';
import { Rng } from '../src/sim/rng';
import { Simulation } from '../src/sim/simulation';
import { World } from '../src/sim/world';

/** A plain, empty, all-ground world for sensor and physics tests. */
export function emptyWorld(overrides: DeepPartial<SimConfig> = {}) {
  const config = resolveConfig({
    world: { width: 32, height: 32 },
    terrain: { waterFraction: 0, rockFraction: 0, fertilityContrast: 0 },
    food: { initialFill: 0 },
    ...overrides,
  });
  return { config, world: new World(config, new Rng(config.seed)) };
}

/**
 * A creature whose genome is all zeros except the trait genes given. Trait genes are
 * normalised: 0 -> the trait's minimum, 1 -> its maximum. Unspecified ones default to 0.5, except diet, which defaults to 0 (a plant eater).
 * An all-zero brain outputs 0 everywhere: no turning, half thrust, no reproducing.
 */
export function makeCreature(
  x: number,
  y: number,
  heading = 0,
  genes: Partial<Record<keyof Traits, number>> = {},
  energy = 50,
) {
  const genome = new Float32Array(GENOME_LENGTH);
  TRAIT_ORDER.forEach((name, i) => (genome[i] = genes[name] ?? (name === 'diet' ? 0 : 0.5)));
  return new Creature(0, x, y, heading, energy, genome);
}

/** A simulation with no creatures, flat ground and no food, for testing one rule at a time. */
export function lifeSim(overrides: DeepPartial<SimConfig> = {}) {
  return new Simulation({
    world: { width: 32, height: 32 },
    ...overrides,
    terrain: { waterFraction: 0, rockFraction: 0, fertilityContrast: 0, ...overrides.terrain },
    food: { initialFill: 0, regrowRate: 0, ...overrides.food },
    creatures: { initialCount: 0, ...overrides.creatures },
  });
}
