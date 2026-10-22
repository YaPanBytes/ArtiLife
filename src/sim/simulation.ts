import { resolveConfig, type DeepPartial, type SimConfig } from './config';
import { OUT_REPRODUCE } from './brain';
import { Creature } from './creature';
import { appetite, upkeep } from './energy';
import { MAX_VISION_RANGE, mutate, randomGenome } from './genome';
import { move } from './physics';
import { Rng } from './rng';
import { sense } from './senses';
import { SpatialHash } from './spatial-hash';
import { World } from './world';

/** Running totals since the start of the run. */
export interface SimStats {
  births: number;
  /** Creatures that ran out of energy. */
  starved: number;
  /** Creatures that reached the maximum age. */
  diedOfAge: number;
}

export type DeathCause = 'starved' | 'age';

/** Owns the world, the creatures and the clock, and advances them one tick at a time. */
export class Simulation {
  readonly config: SimConfig;
  readonly rng: Rng;
  readonly world: World;
  creatures: Creature[] = [];
  readonly stats: SimStats = { births: 0, starved: 0, diedOfAge: 0 };
  tick = 0;
  /** Called after a child is born. Used by the renderer for effects; the sim never reads it. */
  onBirth?: (child: Creature) => void;
  /** Called when a creature dies, before it is removed. */
  onDeath?: (creature: Creature, cause: DeathCause) => void;
  private nextId = 0;
  private readonly hash: SpatialHash;
  private xs: Float64Array;
  private ys: Float64Array;
  private readonly neighbours: number[] = [];
  /** Scratch space for sharing food: what each creature wants, and total demand per tile. */
  private wants = new Float64Array(0);
  private readonly tileDemand: Float64Array;

  constructor(overrides: DeepPartial<SimConfig> = {}) {
    this.config = resolveConfig(overrides);
    this.rng = new Rng(this.config.seed);
    this.world = new World(this.config, this.rng);
    const { initialCount } = this.config.creatures;
    this.hash = new SpatialHash(
      this.world.width,
      this.world.height,
      MAX_VISION_RANGE,
      Math.max(initialCount, 16),
    );
    this.xs = new Float64Array(Math.max(initialCount, 16));
    this.ys = new Float64Array(this.xs.length);
    this.tileDemand = new Float64Array(this.world.width * this.world.height);
    for (let i = 0; i < initialCount; i++) this.spawnRandom();
  }

  /** Add a founder with a random genome on a random walkable tile. */
  spawnRandom(): Creature {
    const { world, rng } = this;
    for (let attempt = 0; attempt < 1000; attempt++) {
      const x = rng.range(0, world.width);
      const y = rng.range(0, world.height);
      if (!world.isWalkable(x, y)) continue;
      const creature = new Creature(
        this.nextId++,
        x,
        y,
        rng.range(-Math.PI, Math.PI),
        this.config.creatures.startEnergy,
        randomGenome(rng),
      );
      this.creatures.push(creature);
      return creature;
    }
    throw new Error('no walkable tile to spawn on');
  }

  /**
   * One tick: grow food; every creature senses and thinks from the same snapshot
   * of the world; then they move, eat, pay upkeep, die, and reproduce.
   */
  step(): void {
    const { world, config } = this;
    world.stepFood(this.tick);
    this.sensePhase();
    for (const c of this.creatures) move(c, world, config);
    this.eatPhase();
    for (const c of this.creatures) {
      c.energy -= upkeep(c, config);
      c.age++;
    }
    this.removeDead();
    this.reproducePhase();
    this.tick++;
  }

  private sensePhase(): void {
    const { creatures, world, config } = this;
    const n = creatures.length;
    if (n > this.xs.length) {
      this.xs = new Float64Array(n * 2);
      this.ys = new Float64Array(n * 2);
    }
    for (let i = 0; i < n; i++) {
      this.xs[i] = creatures[i].x;
      this.ys[i] = creatures[i].y;
    }
    this.hash.build(this.xs, this.ys, n);
    for (const c of creatures) {
      sense(c, world, creatures, this.hash, config, this.neighbours);
      c.think();
    }
  }

  /**
   * Creatures eat plants on the tile they stand on. When several share a tile with
   * too little food, each gets a share in proportion to its appetite, so the
   * result doesn't depend on the order creatures are stored in.
   */
  private eatPhase(): void {
    const { creatures, world, config, tileDemand } = this;
    const n = creatures.length;
    if (this.wants.length < n) this.wants = new Float64Array(n * 2);
    const { wants } = this;
    for (let i = 0; i < n; i++) {
      const c = creatures[i];
      wants[i] = appetite(c, config);
      tileDemand[world.tileIndex(c.x, c.y)] += wants[i];
    }
    for (let i = 0; i < n; i++) {
      const c = creatures[i];
      const tile = world.tileIndex(c.x, c.y);
      const demand = tileDemand[tile];
      const share = demand <= world.food[tile] ? 1 : world.food[tile] / demand;
      c.energy += wants[i] * share;
    }
    for (let i = 0; i < n; i++) {
      const tile = world.tileIndex(creatures[i].x, creatures[i].y);
      if (tileDemand[tile] === 0) continue;
      world.food[tile] = Math.max(0, world.food[tile] - tileDemand[tile]);
      tileDemand[tile] = 0;
    }
  }

  private removeDead(): void {
    const { maxAge } = this.config.creatures;
    const alive: Creature[] = [];
    for (const c of this.creatures) {
      if (c.energy <= 0) {
        this.stats.starved++;
        this.onDeath?.(c, 'starved');
      } else if (maxAge > 0 && c.age >= maxAge) {
        this.stats.diedOfAge++;
        this.onDeath?.(c, 'age');
      } else alive.push(c);
    }
    this.creatures = alive;
  }

  private reproducePhase(): void {
    const { creatures, config } = this;
    const { maxEnergy, birthCost, maxPopulation } = config.creatures;
    const parents = creatures.length;
    for (let i = 0; i < parents; i++) {
      const parent = creatures[i];
      if (creatures.length >= maxPopulation) return;
      if (parent.outputs[OUT_REPRODUCE] <= 0) continue;
      if (parent.energy < parent.traits.reproThreshold * maxEnergy) continue;
      if (parent.energy <= birthCost) continue;
      parent.energy -= birthCost;
      creatures.push(this.birth(parent));
    }
  }

  private birth(parent: Creature): Creature {
    const { world, rng, config } = this;
    const { birthCost, birthEfficiency, maxEnergy } = config.creatures;
    const angle = rng.range(0, 2 * Math.PI);
    const distance = rng.range(0.3, 1);
    let x = parent.x + Math.cos(angle) * distance;
    let y = parent.y + Math.sin(angle) * distance;
    if (world.isWalkable(x, y)) {
      x = world.wrapX(x);
      y = world.wrapY(y);
    } else {
      x = parent.x;
      y = parent.y;
    }
    this.stats.births++;
    const child = new Creature(
      this.nextId++,
      x,
      y,
      rng.range(-Math.PI, Math.PI),
      Math.min(maxEnergy, birthCost * birthEfficiency),
      mutate(parent.genome, rng, config.mutation.magnitude, config.mutation.rateMultiplier),
      parent.id,
      parent.generation + 1,
    );
    this.onBirth?.(child);
    return child;
  }
}
