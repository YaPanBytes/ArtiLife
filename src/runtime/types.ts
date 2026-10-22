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
  /** Names of the temporary rule changes in force, such as a drought. */
  hazards: string[] = [];
  /** Measured simulation speed, in ticks per second. */
  tps = 0;
  stats: SimStats = { births: 0, starved: 0, eaten: 0, disaster: 0, bites: 0, diedOfAge: 0 };
  food = new Float32Array(0);
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

  /** Position in the arrays of the creature with this id, or -1. */
  indexOfId(id: number): number {
    for (let i = 0; i < this.count; i++) if (this.id[i] === id) return i;
    return -1;
  }
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

/** What the game needs from whatever runs the simulation. */
export interface Backend {
  readonly world: WorldInfo;
  readonly scene: Scene;
  readonly detail: CreatureDetail | null;
  readonly analysis: Analysis;
  readonly paused: boolean;
  /** Ticks per 1/60 s, as chosen by the player. */
  readonly speed: number;
  readonly settings: SimConfig;

  newWorld(settings: SimConfig, warmup?: number): void;
  /** Make something happen: a drought, a plague, newcomers. */
  trigger(kind: DisasterKind): void;
  setPaused(paused: boolean): void;
  setSpeed(multiplier: number): void;
  stepOnce(): void;
  /** Change a rule in the running world. */
  setConfig(path: string, value: number | boolean | string): void;
  select(id: number | null): void;
  /** Run for `dtMs` of real time, then bring `scene`, `detail` and `analysis` up to date. */
  update(dtMs: number): void;
}
