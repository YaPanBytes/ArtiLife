import type { SimConfig } from './config';
import type { Creature } from './creature';

/** Share of plant energy a creature can digest: all for a pure herbivore, less the more carnivorous it is. */
export function plantEfficiency(c: Creature, config: SimConfig): number {
  return 1 - config.predation.dietTradeoff * c.traits.diet;
}

/** Share of meat energy a creature can digest, before the world's meat yield. */
export function meatEfficiency(c: Creature): number {
  return c.traits.diet;
}

/** How much plant energy a creature would like to take from its tile this tick. */
export function appetite(c: Creature, config: SimConfig): number {
  const efficiency = plantEfficiency(c, config);
  if (efficiency <= 0) return 0;
  // No point eating more than will fit once digested.
  const room = (config.creatures.maxEnergy - c.energy) / efficiency;
  return Math.max(0, Math.min(config.creatures.eatRate * c.traits.size, room));
}

/**
 * Energy a creature burns this tick: staying alive (grows with size), moving
 * (grows with speed squared and size), seeing (grows with vision range) and
 * calling out (grows with how loud the call is).
 */
export function upkeep(c: Creature, config: SimConfig): number {
  const { basalCost, moveCost, senseCost, signalCost } = config.creatures;
  return (
    basalCost * c.traits.size +
    moveCost * c.speed * c.speed * c.traits.size +
    senseCost * c.traits.visionRange +
    signalCost * Math.abs(c.signal)
  );
}
