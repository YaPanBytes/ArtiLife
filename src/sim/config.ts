/**
 * Simulation configuration. Distances are in tiles (1 world unit = 1 tile),
 * time is in ticks. Every field here is a world rule that can be tweaked.
 */
export interface SimConfig {
  /** Seed for all randomness. Same seed + same config = same world. */
  seed: number;
  world: {
    /** Map size in tiles. The map wraps around at the edges. */
    width: number;
    height: number;
  };
  creatures: {
    /** Creatures spawned at the start. */
    initialCount: number;
    /** Energy a new creature starts with. */
    startEnergy: number;
    /** Energy a creature can hold at most. */
    maxEnergy: number;
    /** Fastest turn, in radians per tick, when the brain's turn output is +/-1. */
    maxTurnRate: number;
    /** How quickly speed follows the commanded speed (0-1 per tick). */
    speedInertia: number;
    /** Plant energy a size-1 creature can eat per tick. Bigger creatures eat more. */
    eatRate: number;
    /** Energy burned per tick just to stay alive, per unit of size. */
    basalCost: number;
    /** Energy burned per tick by moving: moveCost * speed^2 * size. */
    moveCost: number;
    /** Energy burned per tick per tile of vision range. */
    senseCost: number;
    /** Age in ticks at which a creature dies of old age (0 = never). */
    maxAge: number;
    /** Energy the parent pays to reproduce. */
    birthCost: number;
    /** Fraction of the birth cost that reaches the child (the rest is lost). */
    birthEfficiency: number;
    /** No births while the population is at this size. */
    maxPopulation: number;
  };
  mutation: {
    /** Standard deviation of a gene change, on the gene's own scale. */
    magnitude: number;
    /** Scales every creature's own mutation rate. 0 turns mutation off. */
    rateMultiplier: number;
  };
  terrain: {
    /** Approximate size of terrain features, in tiles. */
    scale: number;
    /** Fraction of tiles that are water (0-1). */
    waterFraction: number;
    /** Fraction of tiles that are rock (0-1). */
    rockFraction: number;
    /** 0 = every ground tile is equally fertile, 1 = barren to lush. */
    fertilityContrast: number;
  };
  food: {
    /** Plant energy a tile holds when full. */
    maxPerTile: number;
    /** Plant energy regrown per tick on a fertility-1 tile. */
    regrowRate: number;
    /** Fraction of full food that tiles start with (0-1). */
    initialFill: number;
    seasons: {
      enabled: boolean;
      /** Length of one full season cycle, in ticks. */
      lengthTicks: number;
      /** Strength of the swing (0-1): regrowth varies by +/- this fraction. */
      amplitude: number;
    };
  };
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export const DEFAULT_CONFIG: SimConfig = {
  seed: 1,
  world: { width: 64, height: 64 },
  creatures: {
    initialCount: 60,
    startEnergy: 50,
    maxEnergy: 100,
    maxTurnRate: 0.3,
    speedInertia: 0.3,
    eatRate: 1,
    basalCost: 0.04,
    moveCost: 0.6,
    senseCost: 0.003,
    maxAge: 3000,
    birthCost: 40,
    birthEfficiency: 0.5,
    maxPopulation: 800,
  },
  mutation: { magnitude: 0.1, rateMultiplier: 1 },
  terrain: { scale: 16, waterFraction: 0.1, rockFraction: 0.05, fertilityContrast: 0.6 },
  food: {
    maxPerTile: 10,
    regrowRate: 0.02,
    initialFill: 0.5,
    seasons: { enabled: false, lengthTicks: 4000, amplitude: 0.5 },
  },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function merge<T>(base: T, overrides: unknown, path: string): T {
  if (overrides === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(overrides)) {
    if (typeof overrides !== typeof base) {
      throw new TypeError(`config.${path}: expected ${typeof base}, got ${typeof overrides}`);
    }
    return overrides as T;
  }
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(overrides)) {
    if (!(key in base))
      throw new RangeError(`config.${path ? path + '.' : ''}${key}: unknown option`);
    out[key] = merge(base[key], overrides[key], path ? `${path}.${key}` : key);
  }
  return out as T;
}

function check(ok: boolean, message: string): void {
  if (!ok) throw new RangeError(`config.${message}`);
}

const isFraction = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
const isPositiveInt = (n: number) => Number.isInteger(n) && n > 0;

/** Merge overrides onto the defaults and validate the result. Throws on bad values. */
export function resolveConfig(overrides: DeepPartial<SimConfig> = {}): SimConfig {
  const c = merge(DEFAULT_CONFIG, overrides, '');
  check(Number.isInteger(c.seed), 'seed: must be an integer');
  check(isPositiveInt(c.world.width), 'world.width: must be a positive integer');
  check(isPositiveInt(c.world.height), 'world.height: must be a positive integer');
  check(
    Number.isInteger(c.creatures.initialCount) && c.creatures.initialCount >= 0,
    'creatures.initialCount: must be a non-negative integer',
  );
  check(c.creatures.startEnergy > 0, 'creatures.startEnergy: must be positive');
  check(
    c.creatures.maxEnergy >= c.creatures.startEnergy,
    'creatures.maxEnergy: must be at least startEnergy',
  );
  check(c.creatures.maxTurnRate >= 0, 'creatures.maxTurnRate: must not be negative');
  check(
    isFraction(c.creatures.speedInertia) && c.creatures.speedInertia > 0,
    'creatures.speedInertia: must be above 0 and at most 1',
  );
  check(c.creatures.eatRate >= 0, 'creatures.eatRate: must not be negative');
  check(c.creatures.basalCost >= 0, 'creatures.basalCost: must not be negative');
  check(c.creatures.moveCost >= 0, 'creatures.moveCost: must not be negative');
  check(c.creatures.senseCost >= 0, 'creatures.senseCost: must not be negative');
  check(
    Number.isInteger(c.creatures.maxAge) && c.creatures.maxAge >= 0,
    'creatures.maxAge: must be a non-negative integer',
  );
  check(c.creatures.birthCost > 0, 'creatures.birthCost: must be positive');
  check(
    isFraction(c.creatures.birthEfficiency),
    'creatures.birthEfficiency: must be between 0 and 1',
  );
  check(
    Number.isInteger(c.creatures.maxPopulation) && c.creatures.maxPopulation >= 0,
    'creatures.maxPopulation: must be a non-negative integer',
  );
  check(c.mutation.magnitude >= 0, 'mutation.magnitude: must not be negative');
  check(c.mutation.rateMultiplier >= 0, 'mutation.rateMultiplier: must not be negative');
  check(c.terrain.scale >= 1, 'terrain.scale: must be at least 1');
  check(isFraction(c.terrain.waterFraction), 'terrain.waterFraction: must be between 0 and 1');
  check(isFraction(c.terrain.rockFraction), 'terrain.rockFraction: must be between 0 and 1');
  check(
    c.terrain.waterFraction + c.terrain.rockFraction <= 1,
    'terrain: waterFraction + rockFraction must not exceed 1',
  );
  check(
    isFraction(c.terrain.fertilityContrast),
    'terrain.fertilityContrast: must be between 0 and 1',
  );
  check(c.food.maxPerTile > 0, 'food.maxPerTile: must be positive');
  check(c.food.regrowRate >= 0, 'food.regrowRate: must not be negative');
  check(isFraction(c.food.initialFill), 'food.initialFill: must be between 0 and 1');
  check(c.food.seasons.lengthTicks > 0, 'food.seasons.lengthTicks: must be positive');
  check(isFraction(c.food.seasons.amplitude), 'food.seasons.amplitude: must be between 0 and 1');
  return c;
}
