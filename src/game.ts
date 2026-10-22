import { Chiptune } from './audio';
import { findPreset } from './presets';
import { Camera } from './render/camera';
import { HUD_H, MINIMAP_SIZE, SCREEN_H, SCREEN_W, TILE } from './render/layout';
import { Renderer } from './render/renderer';
import { OVERLAYS, type ViewState } from './render/view';
import { SimHost } from './runtime/host';
import { EFFECT_BIRTH, EFFECT_DEATH, EFFECT_HIT, type Backend } from './runtime/types';
import { WorkerBackend, startWorker } from './runtime/worker-backend';
import { captureCanvas, download, screenshotName } from './screenshot';
import { shareUrl } from './share';
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
/** Screenshots are enlarged by this whole number. */
const SCREENSHOT_SCALE = 4;

export interface GameOptions {
  /** Rules and seed to start with. */
  settings?: SimConfig;
  /** Ticks to run before the first frame. */
  warmup?: number;
  paused?: boolean;
  /** Id of a creature to follow from the start. */
  select?: number;
  /** Run the simulation in a worker (the default where workers exist). */
  worker?: boolean;
}

/** Ties the simulation, renderer, panel and input together and runs the frame loop. */
export class Game {
  readonly view: ViewState;
  private readonly renderer: Renderer;
  private readonly panel: Panel;
  private readonly sound = new Chiptune();
  private speedIndex = DEFAULT_SPEED;
  private lastTime = 0;
  private lastEventCount = 0;
  private readonly keys = new Set<string>();

  /** Start a game. Resolves once the first world exists. */
  static async create(
    canvas: HTMLCanvasElement,
    panelRoot: HTMLElement,
    options: GameOptions = {},
  ): Promise<Game> {
    const settings = options.settings ?? resolveConfig();
    let backend: Backend | null = null;
    if (options.worker !== false && typeof Worker !== 'undefined') {
      try {
        backend = new WorkerBackend(startWorker(), settings, options.warmup ?? 0);
        await backend.ready;
      } catch (error) {
        console.warn('could not start the simulation worker, running on the page instead', error);
        backend = null;
      }
    }
    if (!backend) {
      backend = new SimHost(settings, options.warmup ?? 0);
      await backend.ready;
    }
    return new Game(canvas, panelRoot, backend, settings, options);
  }

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    panelRoot: HTMLElement,
    readonly backend: Backend,
    /** The rules as the player has set them; used to build each new world. */
    private readonly settings: SimConfig,
    options: GameOptions,
  ) {
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
      newWorld: (seed) => void this.newWorld(seed),
      applyLive: (control, value) => this.applyLive(control, value),
      trigger: (kind) => this.backend.trigger(kind),
      toggleGlyph: () => this.toggleGlyph(),
      setIsland: (index) => void this.setIsland(index),
      cycleOverlay: (d) => this.cycleOverlay(d),
      save: () => void this.save(),
      loadFile: (file) => void this.loadFile(file),
      screenshot: () => void this.screenshot(),
      share: () => void this.share(),
      applyPreset: (name) => void this.applyPreset(name),
      setSound: (on) => this.setSound(on),
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

  /** Show a short message in the panel. */
  notify(message: string): void {
    this.panel.notify(message);
  }

  async newWorld(seed: number, warmup = 0): Promise<void> {
    this.settings.seed = seed;
    await this.backend.newWorld(this.settings, warmup);
    this.resetView();
    this.panel.setSeed(seed);
  }

  /** Look at another island: its own map, creatures and statistics. */
  async setIsland(index: number): Promise<void> {
    if (index === this.backend.scene.islands.active || index >= this.backend.scene.islands.count)
      return;
    await this.backend.setIsland(index);
    this.resetView();
  }

  /** Point the camera and renderer at the backend's current world. */
  private resetView(): void {
    const { world } = this.backend;
    this.renderer.setWorld(world, this.backend.analysis);
    const camera = new Camera(world.width, world.height);
    camera.centerOn((world.width * TILE) / 2, (world.height * TILE) / 2);
    this.view.camera = camera;
    this.view.selectedId = null;
    this.backend.select(null);
    this.lastEventCount = this.backend.analysis.events.length;
  }

  /** Make the pending settings match `loaded`, keeping the same object so everything holding it sees the change. */
  private adoptSettings(loaded: SimConfig): void {
    const copy = structuredClone(loaded);
    for (const key of Object.keys(copy) as (keyof SimConfig)[]) {
      (this.settings as unknown as Record<string, unknown>)[key] = copy[key];
    }
    this.panel.syncFromSettings();
    this.panel.setSeed(this.settings.seed);
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

  toggleSound(): void {
    this.setSound(!this.sound.enabled);
  }

  setSound(on: boolean): void {
    this.sound.enabled = on;
    this.panel.setSoundOn(on);
  }

  /** A slider moved: change the rule in the running simulation too. */
  private applyLive(control: Control, value: number | boolean | string): void {
    this.backend.setConfig(control.path, value);
  }

  select(id: number | null): void {
    this.view.selectedId = id;
    this.backend.select(id);
  }

  deselect(): void {
    this.select(null);
  }

  // Files, sharing and presets

  /** Download the whole run as a file. */
  async save(): Promise<void> {
    try {
      const text = await this.backend.save();
      download(
        text,
        `artilife-seed${this.settings.seed}-tick${this.backend.scene.tick}.json`,
        'application/json',
      );
      this.notify('RUN SAVED');
    } catch (error) {
      this.notify(`SAVE FAILED: ${(error as Error).message}`);
    }
  }

  /** Replace the running world with a saved one. */
  async loadFile(file: File): Promise<void> {
    try {
      const loaded = await this.backend.load(await file.text());
      this.adoptSettings(loaded);
      this.resetView();
      this.setPaused(true);
      this.notify('RUN LOADED (PAUSED)');
    } catch (error) {
      this.notify(`${(error as Error).message}`.toUpperCase());
    }
  }

  async screenshot(): Promise<void> {
    const blob = await captureCanvas(this.canvas, SCREENSHOT_SCALE);
    download(blob, screenshotName(this.settings.seed, this.backend.scene.tick), 'image/png');
    this.notify('SCREENSHOT SAVED');
  }

  /** Copy a link that starts a world with these rules and seed. */
  async share(): Promise<void> {
    const link = shareUrl(this.settings, window.location.href);
    try {
      await navigator.clipboard.writeText(link);
      this.notify('LINK COPIED');
    } catch {
      window.prompt('Copy this link:', link);
    }
  }

  /** Start a new world with a preset's rules (and the current seed). */
  async applyPreset(name: string): Promise<void> {
    const preset = findPreset(name);
    if (!preset) return;
    const config = resolveConfig({ ...preset.config, seed: this.settings.seed });
    this.adoptSettings(config);
    await this.newWorld(this.settings.seed);
    this.notify(preset.blurb.toUpperCase());
  }

  // Input

  /** A click on the canvas, in screen pixels (0-255, 0-223). */
  click(sx: number, sy: number): void {
    if (sy < HUD_H) {
      this.clickHud(sx, sy);
      return;
    }
    const { scene, world } = this.backend;
    const [wx, wy] = this.view.camera.toWorld(sx, sy - HUD_H);
    this.select(pickCreature(scene, world, wx / TILE, wy / TILE, PICK_RADIUS));
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

  // The frame loop

  private frame(time: number): void {
    const dt = this.lastTime === 0 ? 1000 / 60 : Math.min(100, time - this.lastTime);
    this.lastTime = time;
    this.scrollWithKeys();

    this.backend.update(dt);
    const { scene, detail, analysis, world } = this.backend;

    // A followed creature that died is no longer followed.
    if (this.view.selectedId !== null && scene.indexOfId(this.view.selectedId) < 0) {
      this.view.selectedId = null;
    }
    this.followSelected();
    this.playSounds(scene.effects, analysis.events.length);

    this.renderer.render(scene, world, detail, analysis, this.view);
    this.panel.setSpeed(SPEEDS[this.speedIndex], this.view.paused ? undefined : scene.tps);
    this.panel.setIslands(scene.islands);
    this.panel.update({ scene, detail, analysis, view: this.view }, time);
  }

  /** Sound for this frame's births, deaths and bites, and for any new headline. */
  private playSounds(effects: readonly number[], eventCount: number): void {
    if (!this.sound.enabled) {
      this.lastEventCount = eventCount;
      return;
    }
    let kinds = 0;
    for (let i = 0; i < effects.length; i += 3) kinds |= 1 << effects[i];
    if (kinds & (1 << EFFECT_BIRTH)) this.sound.play('birth');
    if (kinds & (1 << EFFECT_DEATH)) this.sound.play('death');
    if (kinds & (1 << EFFECT_HIT)) this.sound.play('hit');
    if (eventCount > this.lastEventCount) {
      const latest = this.backend.analysis.events[eventCount - 1];
      if (latest?.major) this.sound.play(latest.kind === 'disaster' ? 'disaster' : 'event');
    }
    this.lastEventCount = eventCount;
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
