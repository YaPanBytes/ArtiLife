import type { SimConfig } from './config';
import type { Creature } from './creature';

/** How much plant energy a creature would like to eat this tick. */
export function appetite(c: Creature, config: SimConfig): number {
  const room = config.creatures.maxEnergy - c.energy;
  return Math.max(0, Math.min(config.creatures.eatRate * c.traits.size, room));
}

/**
 * Energy a creature burns this tick: staying alive (grows with size), moving
 * (grows with speed squared and size) and seeing (grows with vision range).
 */
export function upkeep(c: Creature, config: SimConfig): number {
  const { basalCost, moveCost, senseCost } = config.creatures;
  return (
    basalCost * c.traits.size +
    moveCost * c.speed * c.speed * c.traits.size +
    senseCost * c.traits.visionRange
  );
}
