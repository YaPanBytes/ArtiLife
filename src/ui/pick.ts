import type { Scene, WorldInfo } from '../runtime/types';

/** The id of the creature nearest to a world position, if any is within `radius` tiles. */
export function pickCreature(
  scene: Scene,
  world: WorldInfo,
  x: number,
  y: number,
  radius: number,
): number | null {
  let best: number | null = null;
  let bestDist = radius * radius;
  for (let i = 0; i < scene.count; i++) {
    let dx = Math.abs(scene.x[i] - x) % world.width;
    let dy = Math.abs(scene.y[i] - y) % world.height;
    if (dx > world.width / 2) dx = world.width - dx;
    if (dy > world.height / 2) dy = world.height - dy;
    const d = dx * dx + dy * dy;
    if (d <= bestDist) {
      best = scene.id[i];
      bestDist = d;
    }
  }
  return best;
}
