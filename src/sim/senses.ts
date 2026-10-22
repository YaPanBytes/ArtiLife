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
  inputs.fill(0, 0, SENSE_INPUT_COUNT);

  // Food and obstacles: march along each ray one tile at a time. Walls block the view.
  for (let k = 0; k < RAY_COUNT; k++) {
    const angle = c.heading + (k / (RAY_COUNT - 1) - 0.5) * fov;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const slot = k * RAY_CHANNELS;
    for (let d = 1; d <= range; d++) {
      const i = world.tileIndex(c.x + cos * d, c.y + sin * d);
      const nearness = 1 - d / range;
      if (world.terrain[i] !== Terrain.Ground) {
        inputs[slot + OBSTACLE] = nearness;
        break;
      }
      const food = (world.food[i] / maxFood) * nearness;
      if (food > inputs[slot + FOOD]) inputs[slot + FOOD] = food;
    }
  }

  // Creatures: each one is seen by the ray nearest its bearing, and the closest wins.
  hash.query(c.x, c.y, range, scratch);
  for (const index of scratch) {
    const other = creatures[index];
    if (other === c) continue;
    const dx = world.deltaX(c.x, other.x);
    const dy = world.deltaY(c.y, other.y);
    const dist = Math.hypot(dx, dy);
    const bearing = wrapAngle(Math.atan2(dy, dx) - c.heading);
    const k = Math.round((bearing / fov + 0.5) * (RAY_COUNT - 1));
    if (k < 0 || k >= RAY_COUNT) continue;
    const nearness = 1 - dist / range;
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
  inputs[self + 2] = clamp(world.foodAt(c.x, c.y) / maxFood, 0, 1);
  inputs[self + 3] = c.hurt;
}
