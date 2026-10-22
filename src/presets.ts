import type { DeepPartial, SimConfig } from './sim/config';

export interface Preset {
  name: string;
  /** One line on what to look for. */
  blurb: string;
  /** Settings applied on top of the defaults. The seed is left to the player. */
  config: DeepPartial<SimConfig>;
}

export const PRESETS: readonly Preset[] = [
  {
    name: 'DEFAULT',
    blurb:
      'The standard rules. Plant eaters and hunters usually split off within a few thousand ticks.',
    config: {},
  },
  {
    name: 'LUSH EDEN',
    blurb: 'Plenty of food and little rock. Big crowds, easy living, little pressure to be clever.',
    config: {
      food: { regrowRate: 0.04, initialFill: 0.9 },
      terrain: { waterFraction: 0.12, rockFraction: 0.02, fertilityContrast: 0.25 },
      creatures: { maxPopulation: 1200, initialCount: 100 },
    },
  },
  {
    name: 'DUST BOWL',
    blurb: 'Barren soil with a few fertile patches. Creatures must find the good ground or die.',
    config: {
      food: { regrowRate: 0.011, initialFill: 0.3 },
      terrain: { waterFraction: 0.03, rockFraction: 0.08, fertilityContrast: 1 },
    },
  },
  {
    name: 'ICE AGE',
    blurb: 'Harsh, long seasons with a deadly winter. Boom and bust.',
    config: {
      food: {
        regrowRate: 0.035,
        seasons: { enabled: true, lengthTicks: 3000, amplitude: 0.8, coldCost: 0.5 },
      },
    },
  },
  {
    name: 'ISLAND CHAIN',
    blurb:
      'Rivers cut the world into regions joined by a single ford. Watch populations drift apart.',
    config: {
      terrain: { waterFraction: 0.08, barrier: 'river', barrierCount: 4, barrierGaps: 1 },
      creatures: { initialCount: 100 },
    },
  },
  {
    name: 'GARDEN',
    blurb:
      'Biting does nothing. A peaceful world of plant eaters, to see what evolves without hunting.',
    config: { predation: { biteDamage: 0, meatYield: 0 } },
  },
  {
    name: 'PREDATOR WORLD',
    blurb: 'Hunting pays very well. Expect hunters to boom, strip the prey and crash.',
    config: {
      food: { regrowRate: 0.03 },
      predation: { biteDamage: 14, meatYield: 0.95, dietTradeoff: 0.3, biteCost: 0.05 },
    },
  },
  {
    name: 'MATING SEASON',
    blurb: 'Sexual reproduction with yearly seasons. Species can become reproductively separate.',
    config: {
      creatures: { sexual: true, mateRange: 2.5, initialCount: 100 },
      food: { seasons: { enabled: true, lengthTicks: 4000, amplitude: 0.6, coldCost: 0.2 } },
    },
  },
];

export function findPreset(name: string): Preset | undefined {
  return PRESETS.find((p) => p.name === name);
}
