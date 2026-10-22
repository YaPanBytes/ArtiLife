import { describe, expect, it, vi } from 'vitest';
import { SimHost } from '../src/runtime/host';
import type { Command, Reply } from '../src/runtime/protocol';
import { WorkerBackend, type WorkerLike } from '../src/runtime/worker-backend';
import { WorkerRuntime } from '../src/runtime/worker-runtime';
import { resolveConfig } from '../src/sim/config';

/**
 * A backend and a runtime joined by a fake worker. Every message is
 * structured-cloned on the way, as a real worker would, so nothing that can't
 * cross a thread boundary slips through.
 */
function connect(overrides = {}, warmup = 0) {
  const sent: Reply[] = [];
  const received: Command[] = [];
  const worker: WorkerLike = {
    postMessage(command) {
      const copy = structuredClone(command);
      received.push(copy);
      runtime.handle(copy);
    },
    onmessage: null,
  };
  const runtime = new WorkerRuntime((reply) => {
    const copy = structuredClone(reply);
    sent.push(copy);
    worker.onmessage?.({ data: copy });
  }, 0);
  const backend = new WorkerBackend(worker, resolveConfig({ seed: 4, ...overrides }), warmup);
  return { backend, runtime, sent, received };
}

const frames = (sent: Reply[]) => sent.filter((r) => r.type === 'frame').length;

describe('worker runtime and backend', () => {
  it('starts a world and reports it', async () => {
    const { backend } = connect({ world: { width: 40, height: 30 } });
    await backend.ready;
    expect(backend.world.width).toBe(40);
    expect(backend.world.height).toBe(30);
    expect(backend.world.terrain.length).toBe(1200);
    expect(backend.settings.world.width).toBe(40);
  });

  it('sends frames that match the simulation, and applies them on update', async () => {
    const { backend, runtime } = connect({ creatures: { initialCount: 25 } });
    await backend.ready;
    runtime.pump(20);
    backend.update(16);
    const host = runtime['host'] as SimHost;
    expect(backend.scene.count).toBe(host.sim.creatures.length);
    expect(backend.scene.tick).toBe(host.sim.tick);
    host.sim.creatures.forEach((c, i) => {
      expect(backend.scene.id[i]).toBe(c.id);
      expect(backend.scene.x[i]).toBeCloseTo(c.x, 4);
    });
    expect(backend.scene.food.length).toBe(host.sim.world.food.length);
    expect(backend.analysis.species.length).toBeGreaterThan(0);
  });

  it('asks to be pumped again at once only while it runs flat out and is still behind', async () => {
    const { backend, runtime } = connect({ creatures: { initialCount: 500, startEnergy: 90 } });
    await backend.ready;
    // Far more ticks owed than fit in one burst of work.
    backend.setSpeed(32);
    expect(runtime.pump(100)).toBe(true);
    backend.update(16);
    // The same world at an easy pace keeps up with ease.
    backend.setSpeed(1);
    expect(runtime.pump(116)).toBe(false);
    backend.update(16);
    backend.setSpeed(32);
    backend.setPaused(true);
    expect(runtime.pump(232)).toBe(false);
  });

  it('runs ticks in step with real time and the chosen speed', async () => {
    const { backend, runtime } = connect({ creatures: { initialCount: 5 } });
    await backend.ready;
    backend.setSpeed(2);
    const host = runtime['host'] as SimHost;
    runtime.pump(100); // 100 ms ~ 6 frames, at 2 ticks each
    expect(host.sim.tick).toBeGreaterThanOrEqual(10);
    expect(host.sim.tick).toBeLessThanOrEqual(14);
  });

  it('waits for the page to draw before sending more, and stops simulating meanwhile', async () => {
    const { backend, runtime, sent } = connect();
    await backend.ready;
    for (let t = 20; t <= 400; t += 20) runtime.pump(t);
    expect(frames(sent)).toBe(2);
    const host = runtime['host'] as SimHost;
    const stalledAt = host.sim.tick;
    runtime.pump(500);
    expect(host.sim.tick).toBe(stalledAt);
    backend.update(16); // draws a frame and acknowledges it
    runtime.pump(520);
    expect(frames(sent)).toBe(3);
    expect(host.sim.tick).toBeGreaterThan(stalledAt);
  });

  it('keeps going when several frames arrive between draws, however often that happens', async () => {
    const { backend, runtime, sent } = connect({ creatures: { initialCount: 10 } });
    await backend.ready;
    let t = 20;
    for (let round = 0; round < 30; round++) {
      // Three pumps (so up to three frames) for every draw.
      for (let k = 0; k < 3; k++, t += 20) runtime.pump(t);
      backend.update(16);
    }
    expect(frames(sent)).toBeGreaterThan(30);
    expect((runtime['host'] as SimHost).sim.tick).toBeGreaterThan(100);
  });

  it('acknowledges frames it threw away as well as the one it drew', async () => {
    const { backend, runtime, received } = connect();
    await backend.ready;
    runtime.pump(20);
    runtime.pump(40); // a second frame arrives before the first was drawn
    backend.update(16);
    const acks = received.filter((c) => c.type === 'ack') as Extract<Command, { type: 'ack' }>[];
    expect(acks.map((a) => a.count)).toEqual([2]);
    backend.update(16); // nothing new, nothing to acknowledge
    expect(received.filter((c) => c.type === 'ack')).toHaveLength(1);
  });

  it('sends analysis only when it changes, and the page keeps the last one', async () => {
    const { backend, runtime, sent } = connect({ creatures: { initialCount: 10 } });
    await backend.ready;
    // The host times its analysis refreshes by the real clock, so pump on the same one.
    const t0 = performance.now();
    runtime.pump(t0 + 20);
    backend.update(16);
    const first = backend.analysis;
    runtime.pump(t0 + 40);
    backend.update(16);
    const frameMessages = sent.filter((r) => r.type === 'frame') as Extract<
      Reply,
      { type: 'frame' }
    >[];
    expect(frameMessages[0].frame.analysis).not.toBeNull();
    expect(frameMessages[1].frame.analysis).toBeNull();
    expect(backend.analysis).toBe(first);
    // After enough time the host refreshes its analysis and a new one is sent.
    runtime.pump(t0 + 400);
    backend.update(16);
    runtime.pump(t0 + 420);
    backend.update(16);
    expect(backend.analysis.version).toBeGreaterThan(first.version);
  });

  it('sends births, deaths and bites once', async () => {
    const { backend, runtime } = connect({ creatures: { initialCount: 80 } });
    await backend.ready;
    let total = 0;
    for (let t = 20; t < 3000; t += 20) {
      runtime.pump(t);
      backend.update(16);
      total += backend.scene.effects.length;
      backend.scene.effects = [];
      if (total > 30) break;
    }
    expect(total).toBeGreaterThan(0);
    expect(total % 3).toBe(0);
  });

  it('pauses, steps and sends frames only when something changed while paused', async () => {
    const { backend, runtime, sent } = connect();
    await backend.ready;
    runtime.pump(20);
    backend.update(16);
    backend.setPaused(true);
    const host = runtime['host'] as SimHost;
    const tick = host.sim.tick;
    runtime.pump(40);
    backend.update(16);
    runtime.pump(300);
    runtime.pump(600);
    expect(host.sim.tick).toBe(tick);
    const count = frames(sent);
    runtime.pump(900);
    expect(frames(sent)).toBe(count); // nothing changed, nothing sent
    backend.stepOnce();
    expect(host.sim.tick).toBe(tick + 1);
    runtime.pump(1200);
    backend.update(16);
    expect(backend.scene.tick).toBe(tick + 1);
    expect(backend.paused).toBe(true);
  });

  it('passes on rule changes, selection and disasters', async () => {
    const { backend, runtime } = connect({ creatures: { initialCount: 30 } });
    await backend.ready;
    const host = runtime['host'] as SimHost;
    backend.setConfig('creatures.eatRate', 2.5);
    expect(host.sim.config.creatures.eatRate).toBe(2.5);
    const target = host.sim.creatures[3].id;
    backend.select(target);
    backend.trigger('drought');
    runtime.pump(20);
    backend.update(16);
    expect(backend.detail?.id).toBe(target);
    expect(backend.detail?.brain.edgeWeight.length).toBeGreaterThan(0);
    expect(backend.scene.hazards).toEqual(['DROUGHT']);
    backend.select(null);
    runtime.pump(40);
    backend.update(16);
    expect(backend.detail).toBeNull();
  });

  it('survives a bad command and tells the page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { backend, runtime, sent } = connect();
    await backend.ready;
    backend.setConfig('nope.nothing', 1);
    expect(sent.some((r) => r.type === 'failed')).toBe(true);
    expect(warn).toHaveBeenCalled();
    runtime.pump(20);
    backend.update(16);
    expect(backend.scene.count).toBeGreaterThan(0);
    warn.mockRestore();
  });

  it('saves and loads a run through the worker', async () => {
    const { backend, runtime } = connect({ seed: 9, creatures: { initialCount: 40 } });
    await backend.ready;
    for (let t = 20; t <= 600; t += 20) {
      runtime.pump(t);
      backend.update(16);
    }
    const text = await backend.save();
    const host = runtime['host'] as SimHost;
    const tick = host.sim.tick;
    expect(JSON.parse(text).format).toBe('artilife');
    await backend.newWorld(resolveConfig({ seed: 77 }));
    expect((runtime['host'] as SimHost).sim.tick).toBe(0);
    const settings = await backend.load(text);
    expect(settings.seed).toBe(9);
    expect((runtime['host'] as SimHost).sim.tick).toBe(tick);
    runtime.pump(700);
    backend.update(16);
    expect(backend.scene.tick).toBeGreaterThanOrEqual(tick);
  });

  it('rejects a bad save with the reason', async () => {
    const { backend } = connect();
    await backend.ready;
    await expect(backend.load('not json')).rejects.toThrow(/not valid JSON/);
    await expect(backend.load('{"format":"artilife","version":9}')).rejects.toThrow(/version 9/);
  });

  it('starts a new world on request and drops frames from the old one', async () => {
    const { backend, runtime } = connect({ seed: 1 });
    await backend.ready;
    runtime.pump(20); // a frame of the old world is on its way to being drawn
    await backend.newWorld(resolveConfig({ seed: 2, world: { width: 20, height: 20 } }));
    expect(backend.world.width).toBe(20);
    backend.update(16); // the old frame was thrown away, so there is nothing to draw yet
    expect(backend.scene.count).toBe(0);
    runtime.pump(40);
    backend.update(16);
    expect(backend.scene.count).toBeGreaterThan(0);
    expect(backend.scene.tick).toBeLessThan(10);
    expect(backend.settings.seed).toBe(2);
  });
});

describe('SimHost save and load', () => {
  it('replaces the run and resets selection, and reports the loaded settings', async () => {
    const host = new SimHost(resolveConfig({ seed: 5 }), 100);
    const text = await host.save();
    host.newWorld(resolveConfig({ seed: 6 }), 10);
    host.select(host.sim.creatures[0].id);
    const settings = await host.load(text);
    expect(settings.seed).toBe(5);
    expect(host.sim.tick).toBe(100);
    expect(host.detail).toBeNull();
    expect(host.scene.tick).toBe(100);
    await expect(host.load('{}')).rejects.toThrow(/not an ArtiLife save/);
  });
});
