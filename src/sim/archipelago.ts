import { resolveConfig, type DeepPartial, type SimConfig } from './config';
import type { Creature } from './creature';
import { InnovationRegistry } from './neat';
import { Rng } from './rng';
import { Simulation } from './simulation';

/** Mixed into the seed so the migration draws are independent of any island's own. */
const MIGRATION_SEED_SALT = 0x9e3779b1;

/**
 * A ring of separate worlds. Each island is a full simulation with its own seed
 * and map; they run in step, and every so often a few creatures from each island
 * are carried to the next one round the ring. Gene flow between islands is then a
 * trickle that the rules control.
 *
 * With one island there is no ring and this behaves exactly like a lone Simulation.
 */
export class Archipelago {
  readonly sims: Simulation[];
  /** NEAT numbering shared by every island, so genes mean the same thing wherever a creature goes. */
  readonly innovations: InnovationRegistry;
  /** Chooses who migrates. */
  readonly rng: Rng;

  constructor(
    config: DeepPartial<SimConfig> = {},
    existing?: { sims: Simulation[]; innovations: InnovationRegistry; rng: Rng },
  ) {
    if (existing) {
      this.sims = existing.sims;
      this.innovations = existing.innovations;
      this.rng = existing.rng;
      return;
    }
    const base = resolveConfig(config);
    this.innovations = new InnovationRegistry();
    // Island i uses seed + i, so island 0 is the same world a lone Simulation would make.
    this.sims = Array.from(
      { length: base.islands.count },
      (_, i) => new Simulation({ ...base, seed: base.seed + i }, this.innovations),
    );
    this.rng = new Rng(base.seed ^ MIGRATION_SEED_SALT);
  }

  get tick(): number {
    return this.sims[0].tick;
  }

  /** Advance every island one tick, then migrate if it is time. */
  step(): void {
    for (const sim of this.sims) sim.step();
    const { interval, migrants } = this.sims[0].config.islands;
    if (this.sims.length > 1 && migrants > 0 && this.tick % interval === 0) this.migrate();
  }

  /** Move each island's migrants to the next island round the ring. Everyone is chosen before anyone moves. */
  migrate(): void {
    const { migrants } = this.sims[0].config.islands;
    const n = this.sims.length;
    const leaving = this.sims.map((sim) => this.pick(sim.creatures, migrants));
    this.sims.forEach((sim, i) => sim.detach(leaving[i]));
    leaving.forEach((group, i) => {
      if (group.length === 0) return;
      const destination = this.sims[(i + 1) % n];
      for (const c of group) destination.receive(c);
      destination.events.push(
        destination.tick,
        'info',
        `${group.length} MIGRANT${group.length === 1 ? '' : 'S'} ARRIVE FROM ISLAND ${i + 1}`,
      );
    });
  }

  /** `count` creatures chosen at random, without repeats (or all of them if there are fewer). */
  private pick(creatures: readonly Creature[], count: number): Creature[] {
    const pool = [...creatures];
    const take = Math.min(count, pool.length);
    for (let i = 0; i < take; i++) {
      const j = i + this.rng.int(pool.length - i);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, take);
  }
}
