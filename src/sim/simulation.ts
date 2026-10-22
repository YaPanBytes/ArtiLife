import { resolveConfig, type DeepPartial, type SimConfig } from './config';
import { OUT_REPRODUCE } from './brain';
import { Creature } from './creature';
import { Chronicler, SPECIATION_ANNOUNCE_GAP } from './chronicle';
import { appetite, plantEfficiency, upkeep } from './energy';
import { clamp } from './math';
import { InnovationRegistry } from './neat';
import { DEFAULT_STRUCTURE, type BrainContext, type BrainKind } from './brains';
import { MODIFIER_NAMES, triggerDisaster, type DisasterKind, type Modifier } from './disasters';
import { EventLog } from './events';
import { MAX_VISION_RANGE, crossover, decodeTraits, mutate, randomGenome, setDiet } from './genome';
import { DIET_BINS, History, type Sample } from './history';
import { move } from './physics';
import { findBiteTarget, resolveBites, wantsToBite } from './predation';
import { Rng } from './rng';
import { sense } from './senses';
import { SpeciesTracker, dietClass, genomeDistance } from './species';
import { SpatialHash } from './spatial-hash';
import { World } from './world';

/** Energy that counts as a full-strength reward when brains learn. */
const REWARD_SCALE = 5;
/** How quickly a creature's expectation of reward follows what it actually gets. */
const BASELINE_SPEED = 0.02;

/** Running totals since the start of the run. */
export interface SimStats {
  births: number;
  /** Creatures that ran out of energy. */
  starved: number;
  /** Creatures killed by a bite. */
  eaten: number;
  /** Creatures killed by a plague, meteor or similar. */
  disaster: number;
  /** Bites that landed. */
  bites: number;
  /** Creatures that reached the maximum age. */
  diedOfAge: number;
}

export type DeathCause = 'starved' | 'age' | 'eaten' | 'disaster';

/** Owns the world, the creatures and the clock, and advances them one tick at a time. */
export class Simulation {
  readonly config: SimConfig;
  readonly rng: Rng;
  readonly world: World;
  creatures: Creature[] = [];
  readonly stats: SimStats = {
    births: 0,
    starved: 0,
    eaten: 0,
    disaster: 0,
    bites: 0,
    diedOfAge: 0,
  };
  /** Temporary changes to the rules, such as a drought. */
  modifiers: Modifier[] = [];
  tick = 0;
  readonly events = new EventLog();
  readonly history = new History();
  readonly species: SpeciesTracker;
  private readonly chronicle = new Chronicler();
  private lastSpeciationAnnounced = -Infinity;
  /** Called after a child is born. Used by the renderer for effects; the sim never reads it. */
  onBirth?: (child: Creature) => void;
  /** Called for every bite that lands. */
  onBite?: (attacker: Creature, victim: Creature) => void;
  /** Called when a creature dies, before it is removed. */
  onDeath?: (creature: Creature, cause: DeathCause) => void;
  /** Which kind of brain every creature in this world has. Fixed when the world is made. */
  readonly brainKind: BrainKind;
  /** Numbers handed out to NEAT connections and neurons, so genomes can be compared. */
  readonly innovations: InnovationRegistry;
  private nextId = 0;
  private readonly hash: SpatialHash;
  private xs: Float64Array;
  private ys: Float64Array;
  private readonly neighbours: number[] = [];
  /** Scratch space for finding mates: who is willing, where they stand, and who is near whom. */
  private readonly willing: Creature[] = [];
  private mateXs = new Float64Array(0);
  private mateYs = new Float64Array(0);
  private readonly mateHash: SpatialHash;
  private readonly mateNear: number[] = [];
  /** Scratch space for sharing food: what each creature wants, and total demand per tile. */
  private wants = new Float64Array(0);
  private tiles = new Int32Array(0);
  private readonly tileDemand: Float64Array;

  /**
   * `innovations` can be shared with other worlds, so creatures that move between them
   * keep meaningful NEAT numbering.
   */
  constructor(
    overrides: DeepPartial<SimConfig> = {},
    innovations: InnovationRegistry = new InnovationRegistry(),
  ) {
    this.config = resolveConfig(overrides);
    this.innovations = innovations;
    this.brainKind = this.config.brain.type as BrainKind;
    this.species = new SpeciesTracker(
      () => this.config.species.threshold,
      () => this.brainKind,
      (child, parent) => {
        // Most branchings are quiet drift. Announce a change of diet class, and not too often.
        if (dietClass(child.diet) === dietClass(parent.diet)) return;
        if (this.tick - this.lastSpeciationAnnounced < SPECIATION_ANNOUNCE_GAP) return;
        this.lastSpeciationAnnounced = this.tick;
        this.events.push(
          this.tick,
          'speciation',
          Chronicler.speciationText(child.id, parent.id, child.diet),
          true,
        );
      },
      (species) => {
        if (Chronicler.isNotable(species.peak)) {
          this.events.push(
            this.tick,
            'extinction',
            Chronicler.extinctionText(species.id, species.peak),
          );
        }
      },
    );
    this.rng = new Rng(this.config.seed);
    this.world = new World(this.config, this.rng);
    const { initialCount } = this.config.creatures;
    this.hash = new SpatialHash(
      this.world.width,
      this.world.height,
      MAX_VISION_RANGE,
      Math.max(initialCount, 16),
    );
    this.mateHash = new SpatialHash(this.world.width, this.world.height, MAX_VISION_RANGE);
    this.xs = new Float64Array(Math.max(initialCount, 16));
    this.ys = new Float64Array(this.xs.length);
    this.tileDemand = new Float64Array(this.world.width * this.world.height);
    for (let i = 0; i < initialCount; i++) this.spawnRandom();
  }

  /** Add a founder with a random genome on a random walkable tile. */
  spawnRandom(asFounder = true): Creature {
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
        randomGenome(rng, this.brainKind, this.innovations),
        null,
        0,
        this.brainKind,
      );
      if (asFounder) this.species.addFounder(creature, this.tick);
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
    this.expireModifiers();
    world.stepFood(this.tick, this.modifierFactor('regrow'));
    const upkeepFactor = this.upkeepFactor();
    this.sensePhase();
    for (const c of this.creatures) move(c, world, config);
    this.eatPhase();
    this.stats.bites += resolveBites(this.creatures, config, this.onBite).bites;
    this.learnPhase();
    for (const c of this.creatures) {
      c.energy -= upkeep(c, config) * upkeepFactor;
      c.age++;
    }
    this.removeDead();
    this.reproducePhase();
    this.tick++;
    this.chronicle.update(this);
    if (this.history.due(this.tick)) this.history.record(this.tick, this.sample());
  }

  /** The population as it is now: one value for each tracked series. */
  sample(): Sample {
    const { creatures } = this;
    const n = creatures.length;
    const mean = (f: (c: Creature) => number) =>
      n === 0 ? 0 : creatures.reduce((sum, c) => sum + f(c), 0) / n;
    return {
      population: n,
      meanEnergy: mean((c) => c.energy),
      species: this.species.aliveCount,
      carnivores: n === 0 ? 0 : creatures.filter((c) => c.traits.diet >= 0.6).length / n,
      size: mean((c) => c.traits.size),
      speed: mean((c) => c.traits.maxSpeed),
      vision: mean((c) => c.traits.visionRange),
      fov: mean((c) => c.traits.visionFov),
      diet: mean((c) => c.traits.diet),
    };
  }

  /** How many creatures have a diet in each tenth of the 0-1 range. */
  dietHistogram(): number[] {
    const bins = new Array<number>(DIET_BINS).fill(0);
    for (const c of this.creatures) {
      bins[Math.min(DIET_BINS - 1, Math.floor(c.traits.diet * DIET_BINS))]++;
    }
    return bins;
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
    // Everyone looks before anyone thinks, so each sees what the others were doing
    // last tick (calls included), whatever order they are stored in.
    for (const c of creatures) sense(c, world, creatures, this.hash, config, this.neighbours);
    for (const c of creatures) {
      c.think();
      c.biting = wantsToBite(c);
      c.biteTarget = c.biting
        ? findBiteTarget(c, creatures, this.hash, world, config, this.neighbours)
        : null;
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
    if (this.wants.length < n) {
      this.wants = new Float64Array(n * 2);
      this.tiles = new Int32Array(n * 2);
    }
    const { wants, tiles } = this;
    for (let i = 0; i < n; i++) {
      const c = creatures[i];
      const tile = world.tileIndex(c.x, c.y);
      tiles[i] = tile;
      wants[i] = appetite(c, config);
      tileDemand[tile] += wants[i];
    }
    for (let i = 0; i < n; i++) {
      const c = creatures[i];
      const tile = tiles[i];
      const demand = tileDemand[tile];
      const share = demand <= world.food[tile] ? 1 : world.food[tile] / demand;
      const gained = wants[i] * share * plantEfficiency(c, config);
      c.energy += gained;
      c.reward += gained;
    }
    for (let i = 0; i < n; i++) {
      const tile = tiles[i];
      if (tileDemand[tile] === 0) continue;
      world.food[tile] = Math.max(0, world.food[tile] - tileDemand[tile]);
      tileDemand[tile] = 0;
    }
  }

  /** What mutation needs to know about this world's brains. */
  private brainContext(): BrainContext {
    const { brain } = this.config;
    return {
      kind: this.brainKind,
      innovations: this.innovations,
      structure: {
        ...DEFAULT_STRUCTURE,
        addConnection: brain.addConnectionRate,
        addNode: brain.addNodeRate,
      },
    };
  }

  /** Let each brain adapt to what it just gained or lost, if learning is on. Then forget the reward. */
  private learnPhase(): void {
    const { rate, forgetting } = this.config.learning;
    if (rate <= 0) {
      for (const c of this.creatures) c.reward = 0;
      return;
    }
    for (const c of this.creatures) {
      // Learn from how much better or worse than expected this tick went.
      const surprise = c.reward - c.rewardBaseline;
      c.brain.learn(clamp(surprise / REWARD_SCALE, -1, 1), rate, forgetting);
      c.rewardBaseline += BASELINE_SPEED * surprise;
      c.reward = 0;
    }
  }

  private removeDead(): void {
    const { maxAge } = this.config.creatures;
    const { creatures } = this;
    let kept = 0;
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      const starved = c.energy <= 0;
      const old = maxAge > 0 && c.age >= maxAge;
      if (!starved && !old) {
        creatures[kept++] = c;
        continue;
      }
      this.species.remove(c, this.tick);
      if (starved) {
        const cause = c.hurt ? 'eaten' : 'starved';
        if (cause === 'eaten') this.stats.eaten++;
        else this.stats.starved++;
        this.onDeath?.(c, cause);
      } else {
        this.stats.diedOfAge++;
        this.onDeath?.(c, 'age');
      }
    }
    creatures.length = kept;
  }

  private reproducePhase(): void {
    if (this.config.creatures.sexual) this.reproduceSexually();
    else this.reproduceAsexually();
  }

  private reproduceAsexually(): void {
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
      creatures.push(this.birth(parent, parent.genome));
    }
  }

  /**
   * Two willing creatures close together, with similar enough genomes, make one
   * child between them. Each pays half the birth cost. Each creature mates at most once a tick.
   */
  private reproduceSexually(): void {
    const { creatures, config, world, willing, mateNear } = this;
    const { maxEnergy, birthCost, maxPopulation, mateRange, mateCompatibility } = config.creatures;
    willing.length = 0;
    for (const c of creatures) {
      if (
        c.outputs[OUT_REPRODUCE] > 0 &&
        c.energy >= c.traits.reproThreshold * maxEnergy &&
        c.energy > birthCost / 2
      )
        willing.push(c);
    }
    const count = willing.length;
    if (count < 2) return;
    // Look for mates through a grid of the willing, so a crowd of them isn't compared pairwise.
    if (this.mateXs.length < count) {
      this.mateXs = new Float64Array(count * 2);
      this.mateYs = new Float64Array(count * 2);
    }
    for (let i = 0; i < count; i++) {
      this.mateXs[i] = willing[i].x;
      this.mateYs[i] = willing[i].y;
    }
    this.mateHash.build(this.mateXs, this.mateYs, count);

    const paired = new Uint8Array(count);
    const newborns: Creature[] = [];
    const rangeSq = mateRange * mateRange;
    for (let i = 0; i < count; i++) {
      if (creatures.length + newborns.length >= maxPopulation) break;
      if (paired[i]) continue;
      const a = willing[i];
      let mate = -1;
      let best = Infinity;
      this.mateHash.query(a.x, a.y, mateRange, mateNear);
      for (const j of mateNear) {
        if (j === i || paired[j]) continue;
        const b = willing[j];
        const d = world.distanceSq(a.x, a.y, b.x, b.y);
        // Nearest wins; a tie goes to whoever comes first, as if the list were walked in order.
        if (d > rangeSq || d > best || (d === best && j > mate)) continue;
        if (genomeDistance(a.genome, b.genome, this.brainKind) > mateCompatibility) continue;
        mate = j;
        best = d;
      }
      if (mate < 0) continue;
      const partner = willing[mate];
      paired[i] = paired[mate] = 1;
      a.energy -= birthCost / 2;
      partner.energy -= birthCost / 2;
      newborns.push(this.birth(a, crossover(a.genome, partner.genome, this.rng, this.brainKind)));
    }
    for (const child of newborns) creatures.push(child);
    willing.length = 0;
  }

  /** A child of `parent` from the genome given (the parent's own, or a mix with a mate's), mutated. */
  private birth(parent: Creature, genome: Float32Array): Creature {
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
      mutate(
        genome,
        rng,
        config.mutation.magnitude,
        config.mutation.rateMultiplier,
        this.brainContext(),
      ),
      parent.id,
      parent.generation + 1,
      this.brainKind,
    );
    child.birthTick = this.tick;
    this.species.addChild(child, parent, this.tick);
    this.onBirth?.(child);
    return child;
  }
  // Migration

  /**
   * Take creatures out of this world without killing them (so no death is counted
   * or shown): they are about to turn up somewhere else.
   */
  detach(creatures: readonly Creature[]): void {
    const leaving = new Set(creatures);
    for (const c of leaving) this.species.remove(c, this.tick);
    this.creatures = this.creatures.filter((c) => !leaving.has(c));
  }

  /**
   * Bring in a creature from another world: same genes, energy and age, placed at a
   * random spot and put into the nearest species here. Returns the newcomer.
   */
  receive(from: Creature): Creature {
    const { world, rng } = this;
    let x = 0;
    let y = 0;
    for (let attempt = 0; attempt < 1000; attempt++) {
      x = rng.range(0, world.width);
      y = rng.range(0, world.height);
      if (world.isWalkable(x, y)) break;
    }
    const c = new Creature(
      this.nextId++,
      x,
      y,
      rng.range(-Math.PI, Math.PI),
      from.energy,
      Float32Array.from(from.genome),
      null,
      from.generation,
      this.brainKind,
    );
    c.age = from.age;
    c.birthTick = this.tick;
    c.memory.set(from.memory);
    const live = from.brain.liveWeights();
    if (live) c.brain.setLiveWeights(live);
    c.rewardBaseline = from.rewardBaseline;
    this.species.adopt(c, this.tick);
    this.creatures.push(c);
    return c;
  }

  // Disasters and temporary changes

  /** Make something happen to the world: a drought, a plague, newcomers. */
  trigger(kind: DisasterKind): void {
    triggerDisaster(this, kind);
  }

  /** Product of one factor across all active modifiers. */
  private modifierFactor(factor: 'regrow' | 'upkeep'): number {
    let product = 1;
    for (const m of this.modifiers) product *= m[factor];
    return product;
  }

  /** Upkeep multiplier this tick: active modifiers, and cold stress in a harsh winter. */
  private upkeepFactor(): number {
    let factor = this.modifierFactor('upkeep');
    const { enabled, amplitude, coldCost } = this.config.food.seasons;
    if (enabled && coldCost > 0 && amplitude > 0) {
      const stress = Math.max(0, 1 - this.world.seasonFactor(this.tick)) / amplitude;
      factor *= 1 + coldCost * stress;
    }
    return factor;
  }

  private expireModifiers(): void {
    for (let i = this.modifiers.length - 1; i >= 0; i--) {
      const m = this.modifiers[i];
      if (this.tick < m.endTick) continue;
      this.modifiers.splice(i, 1);
      this.events.push(this.tick, 'disaster', `THE ${MODIFIER_NAMES[m.kind]} ENDS`, true);
    }
  }

  /** Remove every creature the test picks, as if they had died of `cause`. Returns how many. */
  killWhere(test: (c: Creature) => boolean, cause: DeathCause): number {
    const alive: Creature[] = [];
    let killed = 0;
    for (const c of this.creatures) {
      if (!test(c)) {
        alive.push(c);
        continue;
      }
      this.species.remove(c, this.tick);
      if (cause === 'disaster') this.stats.disaster++;
      this.onDeath?.(c, cause);
      killed++;
    }
    this.creatures = alive;
    return killed;
  }

  /**
   * Add `count` newcomers with random brains and diets from `diet()`, as a new species.
   * Returns how many were placed.
   */
  spawnImmigrants(count: number, diet: () => number): number {
    const group: Creature[] = [];
    for (let i = 0; i < count; i++) {
      const c = this.spawnRandom(false);
      setDiet(c.genome, diet());
      Object.assign(c.traits, decodeTraits(c.genome));
      group.push(c);
    }
    this.species.addImmigrants(group, this.tick);
    return group.length;
  }
}
