import type { Simulation } from './simulation';

export type DisasterKind =
  'drought' | 'iceAge' | 'bloom' | 'plague' | 'meteor' | 'hunters' | 'grazers';

export const DISASTER_KINDS: readonly DisasterKind[] = [
  'drought',
  'iceAge',
  'bloom',
  'plague',
  'meteor',
  'hunters',
  'grazers',
];

/** Names and one-line descriptions, for buttons and tooltips. */
export const DISASTER_INFO: Record<DisasterKind, { label: string; hint: string }> = {
  drought: { label: 'DROUGHT', hint: 'Plants almost stop regrowing for a while.' },
  iceAge: { label: 'ICE AGE', hint: 'Slower regrowth and costlier living for a long time.' },
  bloom: { label: 'BLOOM', hint: 'Every plant instantly grows to full size.' },
  plague: { label: 'PLAGUE', hint: 'Kills two in five creatures, chosen at random.' },
  meteor: { label: 'METEOR', hint: 'Kills everything near a random spot and scorches the plants.' },
  hunters: { label: '+HUNTERS', hint: 'Introduces 15 new hunters with random brains.' },
  grazers: { label: '+GRAZERS', hint: 'Introduces 30 new plant eaters with random brains.' },
};

/** A temporary change to the world's rules. */
export interface Modifier {
  kind: 'drought' | 'iceAge';
  endTick: number;
  /** Multiplies plant regrowth. */
  regrow: number;
  /** Multiplies every creature's upkeep. */
  upkeep: number;
}

const DROUGHT_TICKS = 1500;
const ICE_AGE_TICKS = 3000;
const PLAGUE_DEATH_RATE = 0.4;
const METEOR_RADIUS = 6;
const HUNTERS_INTRODUCED = 15;
const GRAZERS_INTRODUCED = 30;

export const MODIFIER_NAMES: Record<Modifier['kind'], string> = {
  drought: 'DROUGHT',
  iceAge: 'ICE AGE',
};

/** Make something happen to the world. Logged as a major event. */
export function triggerDisaster(sim: Simulation, kind: DisasterKind): void {
  const { tick, events, world, rng, config } = sim;
  switch (kind) {
    case 'drought':
      sim.modifiers.push({
        kind: 'drought',
        endTick: tick + DROUGHT_TICKS,
        regrow: 0.1,
        upkeep: 1,
      });
      events.push(tick, 'disaster', 'A DROUGHT BEGINS', true);
      break;
    case 'iceAge':
      sim.modifiers.push({
        kind: 'iceAge',
        endTick: tick + ICE_AGE_TICKS,
        regrow: 0.4,
        upkeep: 1.4,
      });
      events.push(tick, 'disaster', 'AN ICE AGE BEGINS', true);
      break;
    case 'bloom':
      for (let i = 0; i < world.food.length; i++) {
        if (world.fertility[i] > 0) world.food[i] = config.food.maxPerTile;
      }
      events.push(tick, 'disaster', 'THE PLANTS BLOOM', true);
      break;
    case 'plague': {
      const dead = sim.killWhere(() => rng.chance(PLAGUE_DEATH_RATE), 'disaster');
      events.push(tick, 'disaster', `A PLAGUE KILLS ${dead}`, true);
      break;
    }
    case 'meteor': {
      let x = 0;
      let y = 0;
      for (let attempt = 0; attempt < 200; attempt++) {
        x = rng.range(0, world.width);
        y = rng.range(0, world.height);
        if (world.isWalkable(x, y)) break;
      }
      const r2 = METEOR_RADIUS * METEOR_RADIUS;
      const dead = sim.killWhere((c) => world.distanceSq(x, y, c.x, c.y) <= r2, 'disaster');
      for (let ty = 0; ty < world.height; ty++) {
        for (let tx = 0; tx < world.width; tx++) {
          if (world.distanceSq(x, y, tx + 0.5, ty + 0.5) <= r2)
            world.food[ty * world.width + tx] = 0;
        }
      }
      events.push(tick, 'disaster', `A METEOR STRIKES: ${dead} DIE`, true);
      break;
    }
    case 'hunters': {
      const n = sim.spawnImmigrants(HUNTERS_INTRODUCED, () => 0.85 + 0.15 * rng.next());
      events.push(tick, 'disaster', `${n} HUNTERS ARE INTRODUCED`, true);
      break;
    }
    case 'grazers': {
      const n = sim.spawnImmigrants(GRAZERS_INTRODUCED, () => 0.1 * rng.next());
      events.push(tick, 'disaster', `${n} GRAZERS ARE INTRODUCED`, true);
      break;
    }
  }
}
