import { resolveConfig } from '../sim/config';
import type { Command, Reply } from './protocol';
import { SimHost } from './host';

/** How often a frame is sent while the simulation runs, and while it is paused (ms). */
const RUNNING_FRAME_MS = 16;
const PAUSED_FRAME_MS = 100;
/** Frames sent but not yet drawn by the page. Waiting for it to catch up keeps messages from piling up. */
const MAX_IN_FLIGHT = 2;

/**
 * The simulation side of the worker: runs a SimHost, obeys commands from the
 * page and sends back frames. It takes a `post` function rather than touching
 * the worker API, so it can be tested without a real worker.
 */
export class WorkerRuntime {
  private host: SimHost | null = null;
  private lastTime: number;
  private lastSent = -Infinity;
  private inFlight = 0;
  private dirty = true;
  private sentAnalysisVersion = -1;

  constructor(
    private readonly post: (reply: Reply) => void,
    now = performance.now(),
  ) {
    this.lastTime = now;
  }

  handle(command: Command): void {
    try {
      this.dispatch(command);
    } catch (e) {
      // A bad command must not take the worker down; report it and carry on.
      this.post({ type: 'failed', id: -1, message: String((e as Error)?.message ?? e) });
    }
  }

  private dispatch(command: Command): void {
    switch (command.type) {
      case 'newWorld': {
        const settings = resolveConfig(command.settings);
        this.guard(command.id, () => {
          if (this.host) void this.host.newWorld(settings, command.warmup);
          else this.host = new SimHost(settings, command.warmup);
          this.announceWorld(command.id);
        });
        break;
      }
      case 'load':
        this.guard(command.id, async () => {
          this.host ??= new SimHost();
          await this.host.load(command.text);
          this.announceWorld(command.id);
        });
        break;
      case 'save':
        this.guard(command.id, async () => {
          if (!this.host) throw new Error('no world yet');
          this.post({ type: 'saved', id: command.id, text: await this.host.save() });
        });
        break;
      case 'island':
        this.guard(command.id, async () => {
          await this.host?.setIsland(command.index);
          this.announceWorld(command.id);
        });
        break;
      case 'paused':
        this.host?.setPaused(command.value);
        break;
      case 'speed':
        this.host?.setSpeed(command.value);
        break;
      case 'step':
        this.host?.stepOnce();
        break;
      case 'config':
        this.host?.setConfig(command.path, command.value);
        break;
      case 'select':
        this.host?.select(command.id);
        break;
      case 'trigger':
        this.host?.trigger(command.kind);
        break;
      case 'ack':
        this.inFlight = Math.max(0, this.inFlight - command.count);
        return;
    }
    this.dirty = true;
  }

  /**
   * Run the simulation up to `now`, and send a frame if one is due. Call this often.
   * Returns true if it ran flat out and is still behind, so the caller should call again at once.
   */
  pump(now: number): boolean {
    const { host } = this;
    if (!host) return false;
    const dt = Math.min(100, now - this.lastTime);
    this.lastTime = now;
    // If the page isn't drawing the frames it has (a background tab, say), wait
    // instead of simulating ahead of it.
    if (this.inFlight >= MAX_IN_FLIGHT) return false;
    host.run(dt);
    const behind = host.behind;

    const interval = host.paused ? PAUSED_FRAME_MS : RUNNING_FRAME_MS;
    const due = now - this.lastSent >= interval;
    if (!due || this.inFlight >= MAX_IN_FLIGHT || (host.paused && !this.dirty)) return behind;
    host.refresh(false, now);
    const analysis = host.analysis.version !== this.sentAnalysisVersion ? host.analysis : null;
    if (analysis) this.sentAnalysisVersion = analysis.version;
    this.post({
      type: 'frame',
      frame: {
        scene: host.scene.toFrame(),
        detail: host.detail,
        analysis,
        paused: host.paused,
        speed: host.speed,
      },
    });
    host.scene.effects = [];
    this.lastSent = now;
    this.inFlight++;
    this.dirty = false;
    return behind;
  }

  private announceWorld(id: number): void {
    const host = this.host!;
    this.sentAnalysisVersion = -1;
    this.post({ type: 'world', id, world: host.world, settings: structuredClone(host.sim.config) });
  }

  /** Run a step; if it fails, tell the page why instead of letting the worker die. */
  private guard(id: number, work: () => void | Promise<void>): void {
    try {
      const result = work();
      if (result)
        result.catch((e) => this.post({ type: 'failed', id, message: String(e?.message ?? e) }));
    } catch (e) {
      this.post({ type: 'failed', id, message: String((e as Error)?.message ?? e) });
    }
  }
}
