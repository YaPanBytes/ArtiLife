import type { SimConfig } from '../sim/config';
import { getPath, setPath } from '../sim/config-path';

/** A world rule the player can change from the panel. */
export interface Control {
  group: string;
  label: string;
  hint: string;
  kind: 'number' | 'toggle';
  /** Where the rule lives in the config, e.g. 'food.regrowRate'. */
  path: string;
  min?: number;
  max?: number;
  step?: number;
  /** Takes effect only when a new world is made, because it shapes the map. */
  needsReset?: boolean;
  get(c: SimConfig): number | boolean;
  set(c: SimConfig, v: number | boolean): void;
}

const accessors = (path: string) => ({
  path,
  get: (c: SimConfig) => getPath(c, path) as number | boolean,
  set: (c: SimConfig, v: number | boolean) => setPath(c, path, v),
});

const num = (
  group: string,
  label: string,
  hint: string,
  min: number,
  max: number,
  step: number,
  path: string,
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
  ...accessors(path),
});

const toggle = (group: string, label: string, hint: string, path: string): Control => ({
  group,
  label,
  hint,
  kind: 'toggle',
  ...accessors(path),
});

export const CONTROLS: readonly Control[] = [
  num(
    'FOOD',
    'REGROW',
    'Plant energy regrown per tick on a fully fertile tile.',
    0,
    0.08,
    0.002,
    'food.regrowRate',
  ),
  num('FOOD', 'FOOD CAP', 'Plant energy a tile holds when full.', 1, 30, 1, 'food.maxPerTile'),
  toggle(
    'FOOD',
    'SEASONS',
    'Regrowth swings up and down over a yearly cycle.',
    'food.seasons.enabled',
  ),
  num(
    'FOOD',
    'SWING',
    'How strongly seasons change regrowth.',
    0,
    1,
    0.05,
    'food.seasons.amplitude',
  ),
  num('FOOD', 'YEAR LEN', 'Ticks in one year.', 500, 20000, 500, 'food.seasons.lengthTicks'),

  num(
    'COSTS',
    'LIVING',
    'Energy burned per tick just to stay alive, per unit of size.',
    0,
    0.2,
    0.005,
    'creatures.basalCost',
  ),
  num(
    'COSTS',
    'MOVING',
    'Energy burned by moving. Scales with speed squared.',
    0,
    3,
    0.05,
    'creatures.moveCost',
  ),
  num(
    'COSTS',
    'SEEING',
    'Energy burned per tile of vision range.',
    0,
    0.02,
    0.0005,
    'creatures.senseCost',
  ),
  num(
    'COSTS',
    'EATING',
    'Plant energy a size-1 creature can eat per tick.',
    0,
    4,
    0.1,
    'creatures.eatRate',
  ),

  num('LIFE', 'BIRTH COST', 'Energy a parent pays to reproduce.', 10, 90, 1, 'creatures.birthCost'),
  num(
    'LIFE',
    'MAX AGE',
    'Ticks until death of old age. 0 means never.',
    0,
    10000,
    100,
    'creatures.maxAge',
  ),
  num('LIFE', 'MAX POP', 'No births at this population.', 0, 2000, 50, 'creatures.maxPopulation'),

  num(
    'PREDATION',
    'BITE POWER',
    'Energy a size-1 carnivore takes with one bite.',
    0,
    30,
    1,
    'predation.biteDamage',
  ),
  num(
    'PREDATION',
    'BITE COST',
    'Energy burned by every bite attempt.',
    0,
    1,
    0.05,
    'predation.biteCost',
  ),
  num(
    'PREDATION',
    'MEAT YIELD',
    'Share of the energy taken that a carnivore can digest. 0 makes hunting pointless.',
    0,
    1,
    0.05,
    'predation.meatYield',
  ),
  num(
    'PREDATION',
    'DIET COST',
    'Plant digestion a pure carnivore loses. At 1 it cannot eat plants.',
    0,
    1,
    0.05,
    'predation.dietTradeoff',
  ),
  num(
    'PREDATION',
    'WEAK BITE',
    'How hard a plant eater bites, as a share of a carnivore bite.',
    0,
    1,
    0.05,
    'predation.weakBite',
  ),
  num(
    'EVOLUTION',
    'MUT RATE',
    'Scales how often genes change. 0 stops evolution.',
    0,
    4,
    0.1,
    'mutation.rateMultiplier',
  ),
  num('EVOLUTION', 'MUT SIZE', 'How big each gene change is.', 0, 0.5, 0.01, 'mutation.magnitude'),

  num(
    'NEW WORLD',
    'WATER',
    'Share of the map that is water.',
    0,
    0.5,
    0.01,
    'terrain.waterFraction',
    true,
  ),
  num(
    'NEW WORLD',
    'ROCK',
    'Share of the map that is rock.',
    0,
    0.4,
    0.01,
    'terrain.rockFraction',
    true,
  ),
  num(
    'NEW WORLD',
    'FERTILITY',
    'How uneven the soil is, from uniform to barren patches.',
    0,
    1,
    0.05,
    'terrain.fertilityContrast',
    true,
  ),
  num(
    'NEW WORLD',
    'START POP',
    'Creatures at the start.',
    1,
    400,
    1,
    'creatures.initialCount',
    true,
  ),
];

/** Decimal places needed to show values at this step. */
export function decimalsFor(step: number): number {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}
