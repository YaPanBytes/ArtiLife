import { Camera } from './render/camera';
import { HUD_H, MINIMAP_SIZE, SCREEN_H, SCREEN_W, TILE } from './render/layout';
import { Renderer } from './render/renderer';
import { OVERLAYS, type ViewState } from './render/view';
import { SimHost } from './runtime/host';
import type { Backend } from './runtime/types';
import { resolveConfig, type SimConfig } from './sim/config';
import type { Control } from './ui/controls';
import { Panel } from './ui/panel';
import { pickCreature } from './ui/pick';

/** Simulation ticks per 1/60 s, one step per speed setting. */
export const SPEEDS = [1, 2, 4, 8, 16, 32] as const;
const DEFAULT_SPEED = 2;
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
  readonly backend: Backend;
  readonly view: ViewState;
  private readonly renderer: Renderer;
  private readonly panel: Panel;
  /** The rules as the player has set them; used to build each new world. */
  private readonly settings: SimConfig;
  private speedIndex = DEFAULT_SPEED;
  private lastTime = 0;
  private readonly keys = new Set<string>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    panelRoot: HTMLElement,
    options: GameOptions = {},
  ) {
    this.settings = resolveConfig({ seed: options.seed ?? 1 });
    this.backend = new SimHost(this.settings, options.warmup ?? 0);
    this.backend.setSpeed(SPEEDS[this.speedIndex]);
    this.renderer = new Renderer(canvas);
    this.view = {
      camera: new Camera(1, 1),
      selectedId: null,
      paused: options.paused ?? false,
      mode: 'tile',
      overlay: 'none',
    };
    this.backend.setPaused(this.view.paused);
    this.panel = new Panel(panelRoot, this.settings, {
      togglePause: () => this.setPaused(!this.view.paused),
      step: () => this.stepOnce(),
      changeSpeed: (d) => this.changeSpeed(d),
      newWorld: (seed) => this.newWorld(seed),
      applyLive: (control, value) => this.applyLive(control, value),
      toggleGlyph: () => this.toggleGlyph(),
      cycleOverlay: (d) => this.cycleOverlay(d),
    });
    this.panel.setPaused(this.view.paused);
    this.panel.setSpeed(SPEEDS[this.speedIndex]);
    this.panel.setView(this.view.mode, this.view.overlay);
    this.resetView();
    if (options.select !== undefined) this.select(options.select);
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
    this.backend.newWorld(this.settings, warmup);
    this.resetView();
    this.panel.setSeed(seed);
  }

  /** Point the camera and renderer at the backend's current world. */
  private resetView(): void {
    const { world } = this.backend;
    this.renderer.setWorld(world);
    const camera = new Camera(world.width, world.height);
    camera.centerOn((world.width * TILE) / 2, (world.height * TILE) / 2);
    this.view.camera = camera;
    this.view.selectedId = null;
    this.backend.select(null);
  }

  setPaused(paused: boolean): void {
    this.view.paused = paused;
    this.backend.setPaused(paused);
    this.panel.setPaused(paused);
  }

  stepOnce(): void {
    this.setPaused(true);
    this.backend.stepOnce();
  }

  changeSpeed(direction: 1 | -1): void {
    this.speedIndex = Math.min(SPEEDS.length - 1, Math.max(0, this.speedIndex + direction));
    this.backend.setSpeed(SPEEDS[this.speedIndex]);
    this.panel.setSpeed(SPEEDS[this.speedIndex]);
  }

  toggleGlyph(): void {
    this.view.mode = this.view.mode === 'tile' ? 'glyph' : 'tile';
    this.panel.setView(this.view.mode, this.view.overlay);
  }

  cycleOverlay(direction: 1 | -1): void {
    const i = OVERLAYS.indexOf(this.view.overlay);
    this.view.overlay = OVERLAYS[(i + direction + OVERLAYS.length) % OVERLAYS.length];
    this.panel.setView(this.view.mode, this.view.overlay);
  }

  /** A slider moved: change the rule in the running simulation too. */
  private applyLive(control: Control, value: number | boolean): void {
    this.backend.setConfig(control.path, value);
  }

  select(id: number | null): void {
    this.view.selectedId = id;
    this.backend.select(id);
  }

  deselect(): void {
    this.select(null);
  }

  /** A click on the canvas, in screen pixels (0-255, 0-223). */
  click(sx: number, sy: number): void {
    if (sy < HUD_H) {
      this.clickHud(sx, sy);
      return;
    }
    const { scene, world } = this.backend;
    const [wx, wy] = this.view.camera.toWorld(sx, sy - HUD_H);
    const hit = pickCreature(scene, world, wx / TILE, wy / TILE, PICK_RADIUS);
    this.select(hit);
  }

  /** Clicking the minimap moves the camera there. */
  private clickHud(sx: number, sy: number): void {
    const x = sx - 8;
    const y = sy - 4;
    if (x < 0 || y < 0 || x >= MINIMAP_SIZE || y >= MINIMAP_SIZE) return;
    const { world } = this.backend;
    this.deselect();
    this.view.camera.centerOn(
      (x / MINIMAP_SIZE) * world.width * TILE,
      (y / MINIMAP_SIZE) * world.height * TILE,
    );
  }

  panBy(dx: number, dy: number): void {
    this.deselect();
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

    this.backend.update(dt);
    const { scene, detail, analysis, world } = this.backend;

    // A followed creature that died is no longer followed.
    if (this.view.selectedId !== null && detail === null) this.view.selectedId = null;
    this.followSelected();

    this.renderer.render(scene, world, detail, analysis, this.view);
    this.panel.setSpeed(SPEEDS[this.speedIndex], this.view.paused ? undefined : scene.tps);
    this.panel.update({ scene, detail, analysis, view: this.view }, time);
  }

  private followSelected(): void {
    const { selectedId, camera } = this.view;
    if (selectedId === null) return;
    const { scene } = this.backend;
    const i = scene.indexOfId(selectedId);
    if (i < 0) return;
    camera.follow(scene.x[i] * TILE, scene.y[i] * TILE);
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
