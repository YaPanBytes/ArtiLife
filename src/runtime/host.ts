import { setPath } from '../sim/config-path';
import { resolveConfig, type SimConfig } from '../sim/config';
import { describeBrain } from '../sim/brain-graph';
import { TRAIT_COUNT } from '../sim/genome';
import { seasonInfo } from '../sim/season';
import { Simulation } from '../sim/simulation';
import {
  EFFECT_BIRTH,
  EFFECT_DEATH,
  EFFECT_HIT,
  Scene,
  type Analysis,
  type Backend,
  type CreatureDetail,
  type WorldInfo,
} from './types';

/** Give up on catching up if a frame's ticks take longer than this (ms). */
const TICK_BUDGET_MS = 12;
/** How often the slower analysis data is refreshed (ms). */
const ANALYSIS_EVERY_MS = 250;
/** Most effects kept between frames, so a fast-forward can't pile up thousands. */
const MAX_PENDING_EFFECTS = 600;
const FRAME_MS = 1000 / 60;

/**
 * Runs a simulation and keeps a picture of it for the renderer and UI. It has
 * no DOM dependency, so it can run on the page or in a worker.
 */
export class SimHost implements Backend {
  sim!: Simulation;
  settings: SimConfig;
  world!: WorldInfo;
  readonly scene = new Scene();
  detail: CreatureDetail | null = null;
  analysis!: Analysis;
  paused = false;
  speed = 4;
  private selectedId: number | null = null;
  private tickDebt = 0;
  private pendingEffects: number[] = [];
  private lastAnalysis = -Infinity;
  private analysisVersion = 0;
  private tpsTicks = 0;
  private tpsMs = 0;

  constructor(settings: SimConfig = resolveConfig(), warmup = 0) {
    this.settings = settings;
    this.newWorld(settings, warmup);
  }

  newWorld(settings: SimConfig, warmup = 0): void {
    this.settings = settings;
    this.sim = new Simulation(settings);
    for (let i = 0; i < warmup; i++) this.sim.step();
    this.sim.onBirth = (c) => this.addEffect(EFFECT_BIRTH, c.x, c.y);
    this.sim.onDeath = (c) => this.addEffect(EFFECT_DEATH, c.x, c.y);
    this.sim.onBite = (_, victim) => this.addEffect(EFFECT_HIT, victim.x, victim.y);
    const { world } = this.sim;
    this.world = {
      width: world.width,
      height: world.height,
      terrain: Uint8Array.from(world.terrain),
    };
    this.pendingEffects = [];
    this.selectedId = null;
    this.tickDebt = 0;
    this.scene.effects = [];
    this.refresh(true);
  }

  private addEffect(kind: number, x: number, y: number): void {
    if (this.pendingEffects.length < MAX_PENDING_EFFECTS * 3) this.pendingEffects.push(kind, x, y);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setSpeed(multiplier: number): void {
    this.speed = multiplier;
  }

  stepOnce(): void {
    this.paused = true;
    this.sim.step();
  }

  setConfig(path: string, value: number | boolean | string): void {
    setPath(this.sim.config, path, value);
    setPath(this.settings, path, value);
  }

  select(id: number | null): void {
    this.selectedId = id;
  }

  update(dtMs: number): void {
    const ticks = this.advance(dtMs);
    this.tpsTicks += ticks;
    this.tpsMs += dtMs;
    if (this.tpsMs >= 500) {
      this.scene.tps = Math.round((this.tpsTicks * 1000) / this.tpsMs);
      this.tpsTicks = 0;
      this.tpsMs = 0;
    }
    this.refresh(false);
  }

  /** Run as many ticks as the elapsed time and speed call for. Returns how many ran. */
  advance(dtMs: number): number {
    if (this.paused) return 0;
    // Don't try to make up more than a few frames' worth after a stall.
    this.tickDebt = Math.min(this.tickDebt + (dtMs / FRAME_MS) * this.speed, this.speed * 6);
    const start = performance.now();
    let ran = 0;
    while (this.tickDebt >= 1) {
      this.sim.step();
      this.tickDebt -= 1;
      ran++;
      if (performance.now() - start > TICK_BUDGET_MS) {
        this.tickDebt = 0; // can't keep up: run slower rather than fall further behind
        break;
      }
    }
    return ran;
  }

  /** Copy the simulation's current state into `scene`, `detail` and `analysis`. */
  refresh(forceAnalysis: boolean, now = performance.now()): void {
    const { sim, scene } = this;
    const { creatures, config } = sim;
    const n = creatures.length;
    scene.ensureCapacity(n);
    scene.count = n;
    scene.tick = sim.tick;
    scene.maxFood = config.food.maxPerTile;
    scene.maxEnergy = config.creatures.maxEnergy;
    scene.maxAge = config.creatures.maxAge;
    scene.season = seasonInfo(sim.tick, config);
    scene.stats = { ...sim.stats };
    if (scene.food.length !== sim.world.food.length)
      scene.food = new Float32Array(sim.world.food.length);
    scene.food.set(sim.world.food);
    for (let i = 0; i < n; i++) {
      const c = creatures[i];
      scene.id[i] = c.id;
      scene.age[i] = c.age;
      scene.generation[i] = c.generation;
      scene.species[i] = c.speciesId;
      scene.x[i] = c.x;
      scene.y[i] = c.y;
      scene.heading[i] = c.heading;
      scene.speed[i] = c.speed;
      scene.energy[i] = c.energy;
      scene.hue[i] = c.traits.hue;
      scene.size[i] = c.traits.size;
      scene.diet[i] = c.traits.diet;
    }
    scene.effects = this.pendingEffects;
    this.pendingEffects = [];

    this.detail = this.buildDetail();
    if (forceAnalysis || now - this.lastAnalysis >= ANALYSIS_EVERY_MS) {
      this.lastAnalysis = now;
      this.analysis = {
        version: ++this.analysisVersion,
        history: sim.history.data(),
        species: sim.species.list(),
        events: sim.events.events.slice(),
        dietHistogram: sim.dietHistogram(),
      };
    }
  }

  private buildDetail(): CreatureDetail | null {
    if (this.selectedId === null) return null;
    const c = this.sim.creatures.find((creature) => creature.id === this.selectedId);
    if (!c) {
      this.selectedId = null;
      return null;
    }
    return {
      id: c.id,
      parentId: c.parentId,
      generation: c.generation,
      age: c.age,
      energy: c.energy,
      speciesId: c.speciesId,
      traits: c.traits,
      traitGenes: Float32Array.from(c.genome.subarray(0, TRAIT_COUNT)),
      brain: describeBrain(c),
    };
  }
}
