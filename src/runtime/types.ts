import type { SimConfig } from '../sim/config';
import type { DisasterKind } from '../sim/disasters';
import type { BrainGraph } from '../sim/brain-graph';
import type { Traits } from '../sim/genome';
import type { HistoryData } from '../sim/history';
import type { SeasonInfo } from '../sim/season';
import type { SimEvent } from '../sim/events';
import type { SimStats } from '../sim/simulation';
import type { SpeciesInfo } from '../sim/species';

export const EFFECT_BIRTH = 0;
export const EFFECT_DEATH = 1;
export const EFFECT_HIT = 2;

/** Things that stay the same until a new world starts. */
export interface WorldInfo {
  width: number;
  height: number;
  terrain: Uint8Array;
}

/**
 * Everything the renderer needs for one frame, as flat arrays: where each
 * creature is and what it looks like. Arrays may be longer than `count`.
 */
export class Scene {
  tick = 0;
  count = 0;
  maxFood = 1;
  maxEnergy = 1;
  /** Age at which creatures die of old age, or 0 for never. */
  maxAge = 0;
  season: SeasonInfo | null = null;
  /** Which island is on screen, how many there are, and how many creatures live on each. */
  islands: IslandInfo = { count: 1, active: 0, populations: [0] };
  /** Names of the temporary rule changes in force, such as a drought. */
  hazards: string[] = [];
  /** Measured simulation speed, in ticks per second. */
  tps = 0;
  stats: SimStats = { births: 0, starved: 0, eaten: 0, disaster: 0, bites: 0, diedOfAge: 0 };
  food: Float32Array = new Float32Array(0);
  /** Births, deaths and bites since the last frame, as flat [kind, x, y] triples. */
  effects: number[] = [];

  id = new Int32Array(0);
  age = new Int32Array(0);
  generation = new Int32Array(0);
  species = new Int32Array(0);
  x = new Float32Array(0);
  y = new Float32Array(0);
  heading = new Float32Array(0);
  speed = new Float32Array(0);
  energy = new Float32Array(0);
  hue = new Float32Array(0);
  size = new Float32Array(0);
  diet = new Float32Array(0);
  /** The call each creature is making, from -1 to 1. */
  signal = new Float32Array(0);

  /** Make room for at least `n` creatures. */
  ensureCapacity(n: number): void {
    if (this.id.length >= n) return;
    const capacity = Math.max(n, this.id.length * 2, 64);
    this.id = new Int32Array(capacity);
    this.age = new Int32Array(capacity);
    this.generation = new Int32Array(capacity);
    this.species = new Int32Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.heading = new Float32Array(capacity);
    this.speed = new Float32Array(capacity);
    this.energy = new Float32Array(capacity);
    this.hue = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.diet = new Float32Array(capacity);
    this.signal = new Float32Array(capacity);
  }

  /** A copy of this scene with the creature arrays cut to length, for sending to another thread. */
  toFrame(): SceneFrame {
    const n = this.count;
    return {
      tick: this.tick,
      count: n,
      maxFood: this.maxFood,
      maxEnergy: this.maxEnergy,
      maxAge: this.maxAge,
      season: this.season,
      hazards: this.hazards,
      islands: this.islands,
      tps: this.tps,
      stats: { ...this.stats },
      food: this.food.slice(),
      effects: this.effects,
      id: this.id.slice(0, n),
      age: this.age.slice(0, n),
      generation: this.generation.slice(0, n),
      species: this.species.slice(0, n),
      x: this.x.slice(0, n),
      y: this.y.slice(0, n),
      heading: this.heading.slice(0, n),
      speed: this.speed.slice(0, n),
      energy: this.energy.slice(0, n),
      hue: this.hue.slice(0, n),
      size: this.size.slice(0, n),
      diet: this.diet.slice(0, n),
      signal: this.signal.slice(0, n),
    };
  }

  /** Take on the contents of a frame sent from another thread. */
  applyFrame(frame: SceneFrame): void {
    this.ensureCapacity(frame.count);
    this.count = frame.count;
    this.tick = frame.tick;
    this.maxFood = frame.maxFood;
    this.maxEnergy = frame.maxEnergy;
    this.maxAge = frame.maxAge;
    this.season = frame.season;
    this.hazards = frame.hazards;
    this.islands = frame.islands;
    this.tps = frame.tps;
    this.stats = frame.stats;
    this.food = frame.food;
    this.effects = frame.effects;
    this.id.set(frame.id);
    this.age.set(frame.age);
    this.generation.set(frame.generation);
    this.species.set(frame.species);
    this.x.set(frame.x);
    this.y.set(frame.y);
    this.heading.set(frame.heading);
    this.speed.set(frame.speed);
    this.energy.set(frame.energy);
    this.hue.set(frame.hue);
    this.size.set(frame.size);
    this.diet.set(frame.diet);
    this.signal.set(frame.signal);
  }

  /** Position in the arrays of the creature with this id, or -1. */
  indexOfId(id: number): number {
    for (let i = 0; i < this.count; i++) if (this.id[i] === id) return i;
    return -1;
  }
}

/** A scene's contents with the creature arrays exactly `count` long: the form that crosses to a worker. */
export interface SceneFrame {
  tick: number;
  count: number;
  maxFood: number;
  maxEnergy: number;
  maxAge: number;
  season: SeasonInfo | null;
  hazards: string[];
  islands: IslandInfo;
  tps: number;
  stats: SimStats;
  food: Float32Array;
  effects: number[];
  id: Int32Array;
  age: Int32Array;
  generation: Int32Array;
  species: Int32Array;
  x: Float32Array;
  y: Float32Array;
  heading: Float32Array;
  speed: Float32Array;
  energy: Float32Array;
  hue: Float32Array;
  size: Float32Array;
  diet: Float32Array;
  signal: Float32Array;
}

/** One creature in detail, for the inspector. */
export interface CreatureDetail {
  id: number;
  parentId: number | null;
  generation: number;
  age: number;
  energy: number;
  speciesId: number;
  traits: Traits;
  /** The trait genes, each from 0 to 1. */
  traitGenes: Float32Array;
  brain: BrainGraph;
}

/** Slower-changing information for the charts, species tree and log. */
export interface Analysis {
  /** Changes every time the analysis is refreshed. */
  version: number;
  history: HistoryData;
  species: SpeciesInfo[];
  events: SimEvent[];
  dietHistogram: number[];
}

/** The ring of islands, for the island switcher. */
export interface IslandInfo {
  count: number;
  active: number;
  populations: number[];
}

/** What the game needs from whatever runs the simulation. */
export interface Backend {
  readonly world: WorldInfo;
  readonly scene: Scene;
  readonly detail: CreatureDetail | null;
  readonly analysis: Analysis;
  readonly paused: boolean;
  /** Ticks per 1/60 s, as chosen by the player. */
  readonly speed: number;
  /** The rules of the world now running. */
  readonly settings: SimConfig;
  /** Resolves once the first world exists and `world`, `scene` and `analysis` can be read. */
  readonly ready: Promise<void>;

  /** Start a fresh world. Resolves once it exists. */
  newWorld(settings: SimConfig, warmup?: number): Promise<void>;
  /** Look at another island. Resolves once its world is ready to read. */
  setIsland(index: number): Promise<void>;
  /** Make something happen: a drought, a plague, newcomers. */
  trigger(kind: DisasterKind): void;
  setPaused(paused: boolean): void;
  setSpeed(multiplier: number): void;
  stepOnce(): void;
  /** Change a rule in the running world. */
  setConfig(path: string, value: number | boolean | string): void;
  select(id: number | null): void;
  /** The whole run as a JSON string. */
  save(): Promise<string>;
  /** Replace the run with a saved one. Resolves with its settings; rejects with the reason if it is not a valid save. */
  load(text: string): Promise<SimConfig>;
  /** Run for `dtMs` of real time, then bring `scene`, `detail` and `analysis` up to date. */
  update(dtMs: number): void;
}
