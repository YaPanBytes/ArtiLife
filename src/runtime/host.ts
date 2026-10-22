import { setPath } from '../sim/config-path';
import { Archipelago } from '../sim/archipelago';
import { loadArchipelagoFromJson, saveArchipelagoToJson } from '../sim/serialize';
import { resolveConfig, type SimConfig } from '../sim/config';
import { describeBrain } from '../sim/brain-graph';
import { TRAIT_COUNT } from '../sim/genome';
import { MODIFIER_NAMES, type DisasterKind } from '../sim/disasters';
import { seasonInfo } from '../sim/season';
import type { Simulation } from '../sim/simulation';
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
  archipelago!: Archipelago;
  /** Which island is on screen. */
  active = 0;
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
    void this.newWorld(settings, warmup);
  }

  readonly ready = Promise.resolve();

  /** The island being looked at. */
  get sim(): Simulation {
    return this.archipelago.sims[this.active];
  }

  newWorld(settings: SimConfig, warmup = 0): Promise<void> {
    const archipelago = new Archipelago(settings);
    for (let i = 0; i < warmup; i++) archipelago.step();
    this.adopt(archipelago, settings, 0);
    return Promise.resolve();
  }

  /** Make `archipelago` the running world: hook up the effect reporting and reset everything that referred to the old one. */
  private adopt(archipelago: Archipelago, settings: SimConfig, active: number): void {
    this.settings = settings;
    this.archipelago = archipelago;
    this.active = active;
    // Effects are drawn on the island being looked at, so only that island reports them.
    for (const sim of archipelago.sims) {
      sim.onBirth = (c) => sim === this.sim && this.addEffect(EFFECT_BIRTH, c.x, c.y);
      sim.onDeath = (c) => sim === this.sim && this.addEffect(EFFECT_DEATH, c.x, c.y);
      sim.onBite = (_, victim) =>
        sim === this.sim && this.addEffect(EFFECT_HIT, victim.x, victim.y);
    }
    this.showIsland();
  }

  /** Point everything at the island now active: its map, no selection, no stale effects. */
  private showIsland(): void {
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

  setIsland(index: number): Promise<void> {
    if (!Number.isInteger(index) || index < 0 || index >= this.archipelago.sims.length) {
      return Promise.reject(new RangeError(`there is no island ${index + 1}`));
    }
    this.active = index;
    this.showIsland();
    return Promise.resolve();
  }

  save(): Promise<string> {
    return Promise.resolve(saveArchipelagoToJson(this.archipelago, this.active));
  }

  load(text: string): Promise<SimConfig> {
    try {
      const { archipelago, active } = loadArchipelagoFromJson(text);
      const settings = structuredClone(archipelago.sims[0].config);
      this.adopt(archipelago, settings, active);
      return Promise.resolve(structuredClone(settings));
    } catch (error) {
      return Promise.reject(error);
    }
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

  trigger(kind: DisasterKind): void {
    this.sim.trigger(kind);
  }

  stepOnce(): void {
    this.paused = true;
    this.archipelago.step();
  }

  /** Rules are shared by every island. */
  setConfig(path: string, value: number | boolean | string): void {
    for (const sim of this.archipelago.sims) setPath(sim.config, path, value);
    setPath(this.settings, path, value);
  }

  select(id: number | null): void {
    this.selectedId = id;
  }

  update(dtMs: number): void {
    this.run(dtMs);
    this.refresh(false);
  }

  /** Advance the simulation for `dtMs` of real time and keep the speed reading up to date. */
  run(dtMs: number): void {
    const ticks = this.advance(dtMs);
    this.tpsTicks += ticks;
    this.tpsMs += dtMs;
    if (this.tpsMs >= 500) {
      this.scene.tps = Math.round((this.tpsTicks * 1000) / this.tpsMs);
      this.tpsTicks = 0;
      this.tpsMs = 0;
    }
  }

  /** Run as many ticks as the elapsed time and speed call for. Returns how many ran. */
  advance(dtMs: number): number {
    if (this.paused) return 0;
    // Don't try to make up more than a few frames' worth after a stall.
    this.tickDebt = Math.min(this.tickDebt + (dtMs / FRAME_MS) * this.speed, this.speed * 6);
    const start = performance.now();
    let ran = 0;
    while (this.tickDebt >= 1) {
      this.archipelago.step();
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
    scene.hazards = sim.modifiers.map((m) => MODIFIER_NAMES[m.kind]);
    scene.islands = {
      count: this.archipelago.sims.length,
      active: this.active,
      populations: this.archipelago.sims.map((island) => island.creatures.length),
    };
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
      scene.signal[i] = c.signal;
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
