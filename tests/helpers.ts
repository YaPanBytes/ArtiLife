import { resolveConfig, type DeepPartial, type SimConfig } from '../src/sim/config';
import { Creature } from '../src/sim/creature';
import { GENOME_LENGTH } from '../src/sim/genome';
import { Rng } from '../src/sim/rng';
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

/** A creature with a zeroed genome (mid-range traits are set by `genes`). */
export function makeCreature(
  x: number,
  y: number,
  heading = 0,
  genes: Partial<Record<'size' | 'maxSpeed' | 'visionRange' | 'visionFov' | 'hue', number>> = {},
  energy = 50,
) {
  const genome = new Float32Array(GENOME_LENGTH);
  // Trait genes are normalised: 0 -> min, 1 -> max. Defaults: size 1.25, speed ~0.225, range 6, fov ~2.3.
  const order = ['size', 'maxSpeed', 'visionRange', 'visionFov', 'hue'] as const;
  order.forEach((name, i) => (genome[i] = genes[name] ?? 0.5));
  return new Creature(0, x, y, heading, energy, genome);
}
