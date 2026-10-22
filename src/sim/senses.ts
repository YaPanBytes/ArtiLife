import type { SimConfig } from './config';
import type { Creature } from './creature';
import { clamp, wrapAngle } from './math';
import type { SpatialHash } from './spatial-hash';
import { Terrain, type World } from './world';

/** Vision rays fan out across the field of view, left to right. */
export const RAY_COUNT = 5;
/**
 * Per ray: nearest-weighted food, obstacle proximity, creature proximity, the
 * creature's size relative to the viewer, its diet (carnivores look toothy), and
 * the call it is making.
 */
export const RAY_CHANNELS = 6;
/** Own energy, own speed, food on the current tile, and whether it was just bitten. */
export const SELF_INPUTS = 4;
export const SENSE_INPUT_COUNT = RAY_COUNT * RAY_CHANNELS + SELF_INPUTS;

const FOOD = 0;
const OBSTACLE = 1;
const CREATURE = 2;
const CREATURE_SIZE = 3;
const CREATURE_DIET = 4;
const CREATURE_SIGNAL = 5;

/**
 * Fill the first SENSE_INPUT_COUNT entries of `c.inputs` from the world.
 * Every value lies in [-1, 1]; proximity channels are 0 when nothing is seen and
 * approach 1 as the thing seen gets close.
 */
export function sense(
  c: Creature,
  world: World,
  creatures: readonly Creature[],
  hash: SpatialHash,
  config: SimConfig,
  scratch: number[],
): void {
  const { inputs } = c;
  const { visionRange: range, visionFov: fov } = c.traits;
  const maxFood = config.food.maxPerTile;
  // Multiplying by a reciprocal is cheaper than dividing, in a loop that runs for every tile of every ray.
  const invRange = 1 / range;
  const invMaxFood = 1 / maxFood;
  const { width, height, terrain, food } = world;
  const cx = c.x;
  const cy = c.y;
  for (let i = 0; i < SENSE_INPUT_COUNT; i++) inputs[i] = 0;

  // The middle ray points straight ahead, so its direction is the heading itself.
  const headingCos = Math.cos(c.heading);
  const headingSin = Math.sin(c.heading);
  const middle = (RAY_COUNT - 1) / 2;

  // Food and obstacles: march along each ray one tile at a time. Walls block the view.
  for (let k = 0; k < RAY_COUNT; k++) {
    const angle = c.heading + (k / (RAY_COUNT - 1) - 0.5) * fov;
    const cos = k === middle ? headingCos : Math.cos(angle);
    const sin = k === middle ? headingSin : Math.sin(angle);
    const slot = k * RAY_CHANNELS;
    let bestFood = 0;
    for (let d = 1; d <= range; d++) {
      // The tile under the sample point, wrapping around the map. One correction
      // is enough unless the map is smaller than the vision range.
      let tx = Math.floor(cx + cos * d) | 0;
      let ty = Math.floor(cy + sin * d) | 0;
      if (tx < 0) tx += width;
      else if (tx >= width) tx -= width;
      if (ty < 0) ty += height;
      else if (ty >= height) ty -= height;
      if (tx < 0 || tx >= width) tx = ((tx % width) + width) % width;
      if (ty < 0 || ty >= height) ty = ((ty % height) + height) % height;
      const i = ty * width + tx;
      const nearness = 1 - d * invRange;
      if (terrain[i] !== Terrain.Ground) {
        inputs[slot + OBSTACLE] = nearness;
        break;
      }
      const seen = food[i] * invMaxFood * nearness;
      if (seen > bestFood) bestFood = seen;
    }
    inputs[slot + FOOD] = bestFood;
  }

  // Creatures: each one is seen by the ray nearest its bearing, and the closest wins.
  hash.query(cx, cy, range, scratch);
  const halfW = width * 0.5;
  const halfH = height * 0.5;
  // A creature is seen by the outermost ray if its bearing is within 5/8 of the field of
  // view (rounding to the nearest ray); anything wider than that is rejected with a dot
  // product, which is much cheaper than finding its bearing exactly.
  const reach = Math.min(Math.PI, 0.625 * fov + 1e-6);
  const cosReach = Math.cos(reach);
  for (let n = 0; n < scratch.length; n++) {
    const other = creatures[scratch[n]];
    if (other === c) continue;
    let dx = other.x - cx;
    let dy = other.y - cy;
    if (dx > halfW) dx -= width;
    else if (dx < -halfW) dx += width;
    if (dy > halfH) dy -= height;
    else if (dy < -halfH) dy += height;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dx * headingCos + dy * headingSin < dist * cosReach) continue;
    const bearing = wrapAngle(Math.atan2(dy, dx) - c.heading);
    const k = Math.round((bearing / fov + 0.5) * (RAY_COUNT - 1));
    if (k < 0 || k >= RAY_COUNT) continue;
    const nearness = 1 - dist * invRange;
    const slot = k * RAY_CHANNELS;
    if (nearness > inputs[slot + CREATURE]) {
      inputs[slot + CREATURE] = nearness;
      inputs[slot + CREATURE_SIZE] =
        (other.traits.size - c.traits.size) / (other.traits.size + c.traits.size);
      inputs[slot + CREATURE_DIET] = other.traits.diet * 2 - 1;
      inputs[slot + CREATURE_SIGNAL] = other.signal;
    }
  }

  const self = RAY_COUNT * RAY_CHANNELS;
  inputs[self] = clamp(c.energy / config.creatures.maxEnergy, 0, 1);
  inputs[self + 1] = clamp(c.speed / c.traits.maxSpeed, 0, 1);
  inputs[self + 2] = clamp(world.foodAt(cx, cy) / maxFood, 0, 1);
  inputs[self + 3] = c.hurt;
}
