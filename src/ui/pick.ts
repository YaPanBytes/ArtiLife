import type { Creature } from '../sim/creature';
import type { World } from '../sim/world';

/** The creature nearest to a world position, if any is within `radius` tiles. */
export function pickCreature(
  creatures: readonly Creature[],
  world: World,
  x: number,
  y: number,
  radius: number,
): Creature | null {
  let best: Creature | null = null;
  let bestDist = radius * radius;
  for (const c of creatures) {
    const d = world.distanceSq(x, y, c.x, c.y);
    if (d <= bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}
