import { resolveConfig, type DeepPartial, type SimConfig } from './config';
import { Creature } from './creature';
import { MAX_VISION_RANGE, randomGenome } from './genome';
import { move } from './physics';
import { Rng } from './rng';
import { sense } from './senses';
import { SpatialHash } from './spatial-hash';
import { World } from './world';

/** Owns the world, the creatures and the clock, and advances them one tick at a time. */
export class Simulation {
  readonly config: SimConfig;
  readonly rng: Rng;
  readonly world: World;
  readonly creatures: Creature[] = [];
  tick = 0;
  private nextId = 0;
  private readonly hash: SpatialHash;
  private xs: Float64Array;
  private ys: Float64Array;
  private readonly neighbours: number[] = [];

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
    for (let i = 0; i < initialCount; i++) this.spawnRandom();
  }

  /** Add a creature with a random genome on a random walkable tile. */
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
   * One tick. Every creature senses and thinks from the same snapshot of the
   * world before any of them moves, so update order never matters.
   */
  step(): void {
    const { world, creatures, config } = this;
    world.stepFood(this.tick);

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
    for (const c of creatures) {
      move(c, world, config);
      c.age++;
    }
    this.tick++;
  }
}
