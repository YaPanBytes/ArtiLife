import { OUT_THRUST, OUT_TURN } from './brain';
import type { SimConfig } from './config';
import type { Creature } from './creature';
import { wrapAngle } from './math';
import type { World } from './world';

/**
 * Apply a creature's brain outputs: turn, accelerate towards the commanded speed,
 * and move. Water and rock block movement; a creature slides along them when it can.
 */
export function move(c: Creature, world: World, config: SimConfig): void {
  const turn = c.outputs[OUT_TURN];
  const thrust = (c.outputs[OUT_THRUST] + 1) / 2;
  c.heading = wrapAngle(c.heading + turn * config.creatures.maxTurnRate);
  c.speed += (thrust * c.traits.maxSpeed - c.speed) * config.creatures.speedInertia;

  let dx = Math.cos(c.heading) * c.speed;
  let dy = Math.sin(c.heading) * c.speed;
  if (!world.isWalkable(c.x + dx, c.y + dy)) {
    // Blocked: keep whichever axis is free, and lose the speed that went into the wall.
    if (!world.isWalkable(c.x + dx, c.y)) dx = 0;
    if (!world.isWalkable(c.x, c.y + dy)) dy = 0;
    // Cutting a corner: both axes are free alone but the diagonal is not, so take the longer one.
    if (dx !== 0 && dy !== 0) {
      if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    c.speed = Math.hypot(dx, dy);
  }
  c.x = world.wrapX(c.x + dx);
  c.y = world.wrapY(c.y + dy);
}
