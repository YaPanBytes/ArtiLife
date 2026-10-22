import { Camera } from './render/camera';
import { HUD_H, MINIMAP_SIZE, SCREEN_H, SCREEN_W, TILE } from './render/layout';
import { Renderer } from './render/renderer';
import type { ViewState } from './render/view';
import { resolveConfig, type SimConfig } from './sim/config';
import { Simulation } from './sim/simulation';
import type { Control } from './ui/controls';
import { Panel } from './ui/panel';
import { pickCreature } from './ui/pick';

/** Simulation ticks per 1/60 s frame, one step per speed setting. */
export const SPEEDS = [1, 2, 4, 8, 16, 32] as const;
const DEFAULT_SPEED = 2;
/** Give up on catching up if a frame's ticks take longer than this (ms). */
const TICK_BUDGET_MS = 12;
const PAN_SPEED = 3;
/** How close a click has to be to a creature to select it, in tiles. */
const PICK_RADIUS = 1.5;

export interface GameOptions {
  seed?: number;
  /** Ticks to run before the first frame. */
  warmup?: number;
  paused?: boolean;
  /** Id of a creature to follow from the start. */
  select?: number;
}

/** Ties the simulation, renderer, panel and input together and runs the frame loop. */
export class Game {
  sim!: Simulation;
  readonly view: ViewState;
  private readonly renderer: Renderer;
  private readonly panel: Panel;
  /** The rules as the player has set them; used to build each new world. */
  private readonly settings: SimConfig;
  private speedIndex = DEFAULT_SPEED;
  private tickDebt = 0;
  private lastTime = 0;
  private readonly keys = new Set<string>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    panelRoot: HTMLElement,
    options: GameOptions = {},
  ) {
    this.settings = resolveConfig({ seed: options.seed ?? 1 });
    this.renderer = new Renderer(canvas);
    this.view = { camera: new Camera(1, 1), selectedId: null, paused: options.paused ?? false };
    this.panel = new Panel(panelRoot, this.settings, {
      togglePause: () => this.setPaused(!this.view.paused),
      step: () => this.stepOnce(),
      changeSpeed: (d) => this.changeSpeed(d),
      newWorld: (seed) => this.newWorld(seed),
      applyLive: (control, value) => this.applyLive(control, value),
    });
    this.panel.setPaused(this.view.paused);
    this.panel.setSpeed(SPEEDS[this.speedIndex]);
    this.newWorld(this.settings.seed, options.warmup ?? 0);
    if (options.select !== undefined && this.sim.creatures.some((c) => c.id === options.select)) {
      this.view.selectedId = options.select;
    }
    this.fit();
  }

  start(): void {
    const loop = (time: number) => {
      this.frame(time);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  newWorld(seed: number, warmup = 0): void {
    this.settings.seed = seed;
    this.sim = new Simulation(this.settings);
    for (let i = 0; i < warmup; i++) this.sim.step();
    this.sim.onBirth = (c) => this.renderer.addBirth(c);
    this.sim.onDeath = (c) => this.renderer.addDeath(c);
    this.sim.onBite = (_, victim) => this.renderer.addHit(victim);
    this.renderer.setWorld(this.sim.world);
    const camera = new Camera(this.sim.world.width, this.sim.world.height);
    camera.centerOn((this.sim.world.width * TILE) / 2, (this.sim.world.height * TILE) / 2);
    this.view.camera = camera;
    this.view.selectedId = null;
    this.tickDebt = 0;
    this.panel.setSeed(seed);
  }

  setPaused(paused: boolean): void {
    this.view.paused = paused;
    this.panel.setPaused(paused);
  }

  stepOnce(): void {
    this.setPaused(true);
    this.sim.step();
  }

  changeSpeed(direction: 1 | -1): void {
    this.speedIndex = Math.min(SPEEDS.length - 1, Math.max(0, this.speedIndex + direction));
    this.panel.setSpeed(SPEEDS[this.speedIndex]);
  }

  /** A slider moved: change the rule in the running simulation too. */
  private applyLive(control: Control, value: number | boolean): void {
    control.set(this.sim.config, value);
  }

  deselect(): void {
    this.view.selectedId = null;
  }

  /** A click on the canvas, in screen pixels (0-255, 0-223). */
  click(sx: number, sy: number): void {
    if (sy < HUD_H) {
      this.clickHud(sx, sy);
      return;
    }
    const { camera } = this.view;
    const [wx, wy] = camera.toWorld(sx, sy - HUD_H);
    const hit = pickCreature(this.sim.creatures, this.sim.world, wx / TILE, wy / TILE, PICK_RADIUS);
    this.view.selectedId = hit ? hit.id : null;
  }

  /** Clicking the minimap moves the camera there. */
  private clickHud(sx: number, sy: number): void {
    const x = sx - 8;
    const y = sy - 4;
    if (x < 0 || y < 0 || x >= MINIMAP_SIZE || y >= MINIMAP_SIZE) return;
    const { world } = this.sim;
    this.view.selectedId = null;
    this.view.camera.centerOn(
      (x / MINIMAP_SIZE) * world.width * TILE,
      (y / MINIMAP_SIZE) * world.height * TILE,
    );
  }

  panBy(dx: number, dy: number): void {
    this.view.selectedId = null;
    this.view.camera.pan(dx, dy);
  }

  keyDown(key: string): void {
    this.keys.add(key);
  }

  keyUp(key: string): void {
    this.keys.delete(key);
  }

  /** Resize the canvas to the largest whole-number multiple of 256x224 that fits. */
  fit(): void {
    const panelWidth = 296 + 8;
    const chrome = 8; // canvas border
    const wide = window.innerWidth >= SCREEN_W * 2 + chrome + 24 + panelWidth + 16;
    const availW = window.innerWidth - 24 - chrome - (wide ? panelWidth + 16 : 0);
    const availH = window.innerHeight - 24 - chrome;
    const scale = Math.max(1, Math.floor(Math.min(availW / SCREEN_W, availH / SCREEN_H)));
    this.canvas.style.width = `${SCREEN_W * scale}px`;
    this.canvas.style.height = `${SCREEN_H * scale}px`;
  }

  private frame(time: number): void {
    const dt = this.lastTime === 0 ? 1000 / 60 : Math.min(100, time - this.lastTime);
    this.lastTime = time;
    this.scrollWithKeys();

    if (!this.view.paused) {
      this.tickDebt += (dt / (1000 / 60)) * SPEEDS[this.speedIndex];
      const start = performance.now();
      while (this.tickDebt >= 1) {
        this.sim.step();
        this.tickDebt -= 1;
        if (performance.now() - start > TICK_BUDGET_MS) {
          this.tickDebt = 0; // can't keep up: run slower rather than fall further behind
          break;
        }
      }
    }

    this.followSelected();
    this.renderer.render(this.sim, this.view);
  }

  private followSelected(): void {
    const { selectedId, camera } = this.view;
    if (selectedId === null) return;
    const c = this.sim.creatures.find((creature) => creature.id === selectedId);
    if (!c) {
      this.view.selectedId = null; // it died
      return;
    }
    camera.follow(c.x * TILE, c.y * TILE);
  }

  private scrollWithKeys(): void {
    const { keys } = this;
    const dx =
      (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) -
      (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0);
    const dy =
      (keys.has('ArrowDown') || keys.has('s') ? 1 : 0) -
      (keys.has('ArrowUp') || keys.has('w') ? 1 : 0);
    if (dx !== 0 || dy !== 0) this.panBy(dx * PAN_SPEED, dy * PAN_SPEED);
  }
}
