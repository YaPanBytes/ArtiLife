import { OUT_BITE } from './brain';
import type { SimConfig } from './config';
import type { Creature } from './creature';
import { meatEfficiency } from './energy';
import { wrapAngle } from './math';
import type { SpatialHash } from './spatial-hash';
import type { World } from './world';

/** Energy one bite from `c` would take: scales with size, and with diet (carnivores have the teeth). */
export function biteForce(c: Creature, config: SimConfig): number {
  const { biteDamage, weakBite } = config.predation;
  return biteDamage * c.traits.size * (weakBite + (1 - weakBite) * c.traits.diet);
}

/** Does the brain want to bite? Costs energy whether or not anything is in reach. */
export function wantsToBite(c: Creature): boolean {
  return c.outputs[OUT_BITE] > 0;
}

/**
 * The nearest other creature inside the biting cone in front of `c`, or null.
 * Uses positions as they are now, so call it before anyone moves.
 */
export function findBiteTarget(
  c: Creature,
  creatures: readonly Creature[],
  hash: SpatialHash,
  world: World,
  config: SimConfig,
  scratch: number[],
): Creature | null {
  const { biteRange, biteArc } = config.predation;
  hash.query(c.x, c.y, biteRange, scratch);
  let best: Creature | null = null;
  let bestDist = Infinity;
  for (const index of scratch) {
    const other = creatures[index];
    if (other === c) continue;
    const dx = world.deltaX(c.x, other.x);
    const dy = world.deltaY(c.y, other.y);
    const dist = Math.hypot(dx, dy);
    if (dist >= bestDist) continue;
    if (Math.abs(wrapAngle(Math.atan2(dy, dx) - c.heading)) > biteArc) continue;
    best = other;
    bestDist = dist;
  }
  return best;
}

/** Energy each creature gains and loses this phase, held until every bite has been worked out. */
let gains = new Float64Array(0);
let losses = new Float64Array(0);

export interface BiteResult {
  /** Bites that landed. */
  bites: number;
}

/**
 * Settle all bites at once, so the result doesn't depend on creature order.
 * Every attempt costs the biter energy. Each landed bite takes damage from its
 * victim; if several bites add up to more than the victim has, they share what
 * is left in proportion. The biter digests the energy it took according to its
 * diet and the world's meat yield.
 */
export function resolveBites(
  creatures: readonly Creature[],
  config: SimConfig,
  onBite?: (attacker: Creature, victim: Creature) => void,
): BiteResult {
  const { biteCost, meatYield } = config.predation;
  const { maxEnergy } = config.creatures;
  const n = creatures.length;
  if (gains.length < n) {
    gains = new Float64Array(n * 2);
    losses = new Float64Array(n * 2);
  }
  let bites = 0;

  for (const c of creatures) {
    c.hurt = 0;
    c.incomingDamage = 0;
  }
  for (const c of creatures) {
    if (c.biteTarget) c.biteTarget.incomingDamage += biteForce(c, config);
  }
  // Work out everything from the energies as they are now, before changing any.
  for (let i = 0; i < n; i++) {
    const c = creatures[i];
    losses[i] = Math.min(c.incomingDamage, Math.max(0, c.energy));
    gains[i] = 0;
    const victim = c.biteTarget;
    if (!victim) continue;
    const planned = biteForce(c, config);
    const share =
      victim.incomingDamage <= victim.energy
        ? 1
        : Math.max(0, victim.energy) / victim.incomingDamage;
    gains[i] = planned * share * meatYield * meatEfficiency(c);
    victim.hurt = 1;
    bites++;
    onBite?.(c, victim);
  }
  for (let i = 0; i < n; i++) {
    const c = creatures[i];
    const cost = c.biting ? biteCost : 0;
    c.energy = Math.min(maxEnergy, c.energy - cost + gains[i] - losses[i]);
  }
  return { bites };
}
