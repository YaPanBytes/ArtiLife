import type { SimConfig } from '../sim/config';

/** A world rule the player can change from the panel. */
export interface Control {
  group: string;
  label: string;
  hint: string;
  kind: 'number' | 'toggle';
  min?: number;
  max?: number;
  step?: number;
  /** Takes effect only when a new world is made, because it shapes the map. */
  needsReset?: boolean;
  get(c: SimConfig): number | boolean;
  set(c: SimConfig, v: number | boolean): void;
}

const num = (
  group: string,
  label: string,
  hint: string,
  min: number,
  max: number,
  step: number,
  get: (c: SimConfig) => number,
  set: (c: SimConfig, v: number) => void,
  needsReset = false,
): Control => ({
  group,
  label,
  hint,
  kind: 'number',
  min,
  max,
  step,
  needsReset,
  get,
  set: set as Control['set'],
});

export const CONTROLS: readonly Control[] = [
  num(
    'FOOD',
    'REGROW',
    'Plant energy regrown per tick on a fully fertile tile.',
    0,
    0.08,
    0.002,
    (c) => c.food.regrowRate,
    (c, v) => (c.food.regrowRate = v),
  ),
  num(
    'FOOD',
    'FOOD CAP',
    'Plant energy a tile holds when full.',
    1,
    30,
    1,
    (c) => c.food.maxPerTile,
    (c, v) => (c.food.maxPerTile = v),
  ),
  {
    group: 'FOOD',
    label: 'SEASONS',
    hint: 'Regrowth swings up and down over a yearly cycle.',
    kind: 'toggle',
    get: (c) => c.food.seasons.enabled,
    set: (c, v) => (c.food.seasons.enabled = v as boolean),
  },
  num(
    'FOOD',
    'SWING',
    'How strongly seasons change regrowth.',
    0,
    1,
    0.05,
    (c) => c.food.seasons.amplitude,
    (c, v) => (c.food.seasons.amplitude = v),
  ),
  num(
    'FOOD',
    'YEAR LEN',
    'Ticks in one year.',
    500,
    20000,
    500,
    (c) => c.food.seasons.lengthTicks,
    (c, v) => (c.food.seasons.lengthTicks = v),
  ),

  num(
    'COSTS',
    'LIVING',
    'Energy burned per tick just to stay alive, per unit of size.',
    0,
    0.2,
    0.005,
    (c) => c.creatures.basalCost,
    (c, v) => (c.creatures.basalCost = v),
  ),
  num(
    'COSTS',
    'MOVING',
    'Energy burned by moving. Scales with speed squared.',
    0,
    3,
    0.05,
    (c) => c.creatures.moveCost,
    (c, v) => (c.creatures.moveCost = v),
  ),
  num(
    'COSTS',
    'SEEING',
    'Energy burned per tile of vision range.',
    0,
    0.02,
    0.0005,
    (c) => c.creatures.senseCost,
    (c, v) => (c.creatures.senseCost = v),
  ),
  num(
    'COSTS',
    'EATING',
    'Plant energy a size-1 creature can eat per tick.',
    0,
    4,
    0.1,
    (c) => c.creatures.eatRate,
    (c, v) => (c.creatures.eatRate = v),
  ),

  num(
    'LIFE',
    'BIRTH COST',
    'Energy a parent pays to reproduce.',
    10,
    90,
    1,
    (c) => c.creatures.birthCost,
    (c, v) => (c.creatures.birthCost = v),
  ),
  num(
    'LIFE',
    'MAX AGE',
    'Ticks until death of old age. 0 means never.',
    0,
    10000,
    100,
    (c) => c.creatures.maxAge,
    (c, v) => (c.creatures.maxAge = v),
  ),
  num(
    'LIFE',
    'MAX POP',
    'No births at this population.',
    0,
    2000,
    50,
    (c) => c.creatures.maxPopulation,
    (c, v) => (c.creatures.maxPopulation = v),
  ),

  num(
    'PREDATION',
    'BITE POWER',
    'Energy a size-1 carnivore takes with one bite.',
    0,
    30,
    1,
    (c) => c.predation.biteDamage,
    (c, v) => (c.predation.biteDamage = v),
  ),
  num(
    'PREDATION',
    'BITE COST',
    'Energy burned by every bite attempt.',
    0,
    1,
    0.05,
    (c) => c.predation.biteCost,
    (c, v) => (c.predation.biteCost = v),
  ),
  num(
    'PREDATION',
    'MEAT YIELD',
    'Share of the energy taken that a carnivore can digest. 0 makes hunting pointless.',
    0,
    1,
    0.05,
    (c) => c.predation.meatYield,
    (c, v) => (c.predation.meatYield = v),
  ),
  num(
    'PREDATION',
    'DIET COST',
    'Plant digestion a pure carnivore loses. At 1 it cannot eat plants.',
    0,
    1,
    0.05,
    (c) => c.predation.dietTradeoff,
    (c, v) => (c.predation.dietTradeoff = v),
  ),
  num(
    'PREDATION',
    'WEAK BITE',
    'How hard a plant eater bites, as a share of a carnivore bite.',
    0,
    1,
    0.05,
    (c) => c.predation.weakBite,
    (c, v) => (c.predation.weakBite = v),
  ),
  num(
    'EVOLUTION',
    'MUT RATE',
    'Scales how often genes change. 0 stops evolution.',
    0,
    4,
    0.1,
    (c) => c.mutation.rateMultiplier,
    (c, v) => (c.mutation.rateMultiplier = v),
  ),
  num(
    'EVOLUTION',
    'MUT SIZE',
    'How big each gene change is.',
    0,
    0.5,
    0.01,
    (c) => c.mutation.magnitude,
    (c, v) => (c.mutation.magnitude = v),
  ),

  num(
    'NEW WORLD',
    'WATER',
    'Share of the map that is water.',
    0,
    0.5,
    0.01,
    (c) => c.terrain.waterFraction,
    (c, v) => (c.terrain.waterFraction = v),
    true,
  ),
  num(
    'NEW WORLD',
    'ROCK',
    'Share of the map that is rock.',
    0,
    0.4,
    0.01,
    (c) => c.terrain.rockFraction,
    (c, v) => (c.terrain.rockFraction = v),
    true,
  ),
  num(
    'NEW WORLD',
    'FERTILITY',
    'How uneven the soil is, from uniform to barren patches.',
    0,
    1,
    0.05,
    (c) => c.terrain.fertilityContrast,
    (c, v) => (c.terrain.fertilityContrast = v),
    true,
  ),
  num(
    'NEW WORLD',
    'START POP',
    'Creatures at the start.',
    1,
    400,
    1,
    (c) => c.creatures.initialCount,
    (c, v) => (c.creatures.initialCount = v),
    true,
  ),
];

/** Decimal places needed to show values at this step. */
export function decimalsFor(step: number): number {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}
