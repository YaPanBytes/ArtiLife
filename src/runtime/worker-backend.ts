import type { SimConfig } from '../sim/config';
import type { DisasterKind } from '../sim/disasters';
import type { Command, Reply } from './protocol';
import { Scene, type Analysis, type Backend, type CreatureDetail, type WorldInfo } from './types';

/** The part of a Worker we use, so tests can stand in for it. */
export interface WorkerLike {
  postMessage(message: Command): void;
  onmessage: ((event: { data: Reply }) => void) | null;
  onerror?: ((event: { message?: string }) => void) | null;
  terminate?(): void;
}

interface Waiter {
  resolve(value: never): void;
  reject(error: Error): void;
}

const EMPTY_ANALYSIS: Analysis = {
  version: 0,
  history: {
    ticks: new Float64Array(0),
    length: 0,
    series: {} as Analysis['history']['series'],
    version: 0,
  },
  species: [],
  events: [],
  dietHistogram: [],
};

/**
 * A Backend whose simulation runs in a worker. Commands go out as messages;
 * frames come back and are applied on the next `update`, so drawing never waits
 * for the simulation.
 */
export class WorkerBackend implements Backend {
  world: WorldInfo = { width: 1, height: 1, terrain: new Uint8Array(1) };
  readonly scene = new Scene();
  detail: CreatureDetail | null = null;
  analysis: Analysis = EMPTY_ANALYSIS;
  paused = false;
  speed = 4;
  settings: SimConfig;
  readonly ready: Promise<void>;
  private nextId = 0;
  private readonly waiting = new Map<number, Waiter>();
  private latest: Extract<Reply, { type: 'frame' }>['frame'] | null = null;
  /** Frames received since the last acknowledgement, whether drawn or thrown away. */
  private unacknowledged = 0;

  constructor(
    private readonly worker: WorkerLike,
    settings: SimConfig,
    warmup = 0,
  ) {
    this.settings = settings;
    worker.onmessage = (event) => this.receive(event.data);
    worker.onerror = (event) => {
      const error = new Error(event.message ?? 'the simulation worker failed');
      for (const waiter of this.waiting.values()) waiter.reject(error);
      this.waiting.clear();
    };
    this.ready = this.newWorld(settings, warmup);
  }

  private request<T>(send: (id: number) => void): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as Waiter['resolve'], reject });
      send(id);
    });
  }

  private receive(reply: Reply): void {
    switch (reply.type) {
      case 'frame':
        // Only the newest frame is worth drawing; older ones are dropped, but still counted.
        this.latest = reply.frame;
        this.unacknowledged++;
        break;
      case 'world': {
        this.world = reply.world;
        this.settings = reply.settings;
        this.latest = null;
        this.settle(reply.id, reply.settings);
        break;
      }
      case 'saved':
        this.settle(reply.id, reply.text);
        break;
      case 'failed': {
        const waiter = this.waiting.get(reply.id);
        this.waiting.delete(reply.id);
        if (waiter) waiter.reject(new RangeError(reply.message));
        else console.warn(`simulation worker: ${reply.message}`);
        break;
      }
    }
  }

  private settle(id: number, value: unknown): void {
    const waiter = this.waiting.get(id);
    this.waiting.delete(id);
    waiter?.resolve(value as never);
  }

  private send(command: Command): void {
    this.worker.postMessage(command);
  }

  newWorld(settings: SimConfig, warmup = 0): Promise<void> {
    return this.request<SimConfig>((id) =>
      this.send({ type: 'newWorld', id, settings, warmup }),
    ).then(() => undefined);
  }

  load(text: string): Promise<SimConfig> {
    return this.request<SimConfig>((id) => this.send({ type: 'load', id, text }));
  }

  save(): Promise<string> {
    return this.request<string>((id) => this.send({ type: 'save', id }));
  }

  setIsland(index: number): Promise<void> {
    return this.request<SimConfig>((id) => this.send({ type: 'island', id, index })).then(
      () => undefined,
    );
  }

  trigger(kind: DisasterKind): void {
    this.send({ type: 'trigger', kind });
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.send({ type: 'paused', value: paused });
  }

  setSpeed(multiplier: number): void {
    this.speed = multiplier;
    this.send({ type: 'speed', value: multiplier });
  }

  stepOnce(): void {
    this.paused = true;
    this.send({ type: 'step' });
  }

  setConfig(path: string, value: number | boolean | string): void {
    this.send({ type: 'config', path, value });
  }

  select(id: number | null): void {
    this.send({ type: 'select', id });
  }

  /**
   * Apply the newest frame from the worker, if one has arrived, and tell it how
   * many frames it can now forget about. Acknowledging here, rather than on
   * arrival, is what stops the worker simulating ahead of a page that isn't drawing.
   */
  update(_dtMs?: number): void {
    const frame = this.latest;
    this.latest = null;
    if (frame) {
      this.scene.applyFrame(frame.scene);
      this.detail = frame.detail;
      if (frame.analysis) this.analysis = frame.analysis;
    }
    if (this.unacknowledged > 0) {
      this.send({ type: 'ack', count: this.unacknowledged });
      this.unacknowledged = 0;
    }
  }

  terminate(): void {
    this.worker.terminate?.();
  }
}

/** Start a worker running the simulation. */
export function startWorker(): WorkerLike {
  return new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike;
}
