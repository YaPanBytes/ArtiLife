import { describe, expect, it } from 'vitest';
import { SimHost } from '../src/runtime/host';
import { WorkerBackend, type WorkerLike } from '../src/runtime/worker-backend';
import { WorkerRuntime } from '../src/runtime/worker-runtime';
import type { Command, Reply } from '../src/runtime/protocol';
import { Archipelago } from '../src/sim/archipelago';
import { floatsToBase64 } from '../src/sim/base64';
import { resolveConfig } from '../src/sim/config';
import { loadArchipelagoFromJson, saveArchipelagoToJson, saveToJson } from '../src/sim/serialize';
import { Simulation } from '../src/sim/simulation';

const islands = (over = {}, extra = {}) =>
  new Archipelago({
    seed: 3,
    creatures: { initialCount: 40 },
    islands: { count: 3, interval: 20, migrants: 3 },
    ...extra,
    ...(over as object),
  });

describe('Archipelago', () => {
  it('makes one world per island, each with its own map and seed', () => {
    const a = islands();
    expect(a.sims).toHaveLength(3);
    expect(a.sims.map((s) => s.config.seed)).toEqual([3, 4, 5]);
    expect(a.sims[0].world.terrain).not.toEqual(a.sims[1].world.terrain);
    expect(a.sims.every((s) => s.creatures.length === 40)).toBe(true);
  });

  it('is exactly a single world when there is one island, or no migrants', () => {
    const lone = new Simulation({ seed: 3, creatures: { initialCount: 30 } });
    const solo = new Archipelago({ seed: 3, creatures: { initialCount: 30 } });
    const quiet = new Archipelago({
      seed: 3,
      creatures: { initialCount: 30 },
      islands: { count: 2, interval: 5, migrants: 0 },
    });
    for (let t = 0; t < 300; t++) {
      lone.step();
      solo.step();
      quiet.step();
    }
    // Same run, apart from the island setting itself.
    const state = (sim: Simulation) => {
      const saved = JSON.parse(saveToJson(sim));
      delete saved.config.islands;
      return JSON.stringify(saved);
    };
    expect(state(solo.sims[0])).toBe(state(lone));
    expect(state(quiet.sims[0])).toBe(state(lone)); // island 0 never hears from island 1
  });

  it('steps every island together', () => {
    const a = islands();
    for (let t = 0; t < 7; t++) a.step();
    expect(a.sims.map((s) => s.tick)).toEqual([7, 7, 7]);
    expect(a.tick).toBe(7);
  });

  it('carries migrants round a ring, conserving creatures and their genes', () => {
    const a = islands();
    // Tag each island's creatures by energy so we can see who went where.
    a.sims.forEach((sim, i) => sim.creatures.forEach((c) => (c.energy = 10 + i * 20)));
    const total = a.sims.reduce((n, s) => n + s.creatures.length, 0);
    const genomes = a.sims.map(
      (s) => new Set(s.creatures.map((c) => Array.from(c.genome).join(','))),
    );
    a.migrate();
    expect(a.sims.reduce((n, s) => n + s.creatures.length, 0)).toBe(total);
    a.sims.forEach((sim, i) => {
      expect(sim.creatures).toHaveLength(40); // three out, three in
      const from = (i + a.sims.length - 1) % a.sims.length;
      const arrivals = sim.creatures.filter(
        (c) => c.energy === 10 + from * 20 && c.age === 0 && c.birthTick === sim.tick,
      );
      expect(arrivals).toHaveLength(3);
      for (const c of arrivals) {
        // Same genes as a creature that lived on the island before it.
        expect(genomes[from].has(Array.from(c.genome).join(','))).toBe(true);
        expect(sim.world.isWalkable(c.x, c.y)).toBe(true);
      }
    });
  });

  it('gives every creature a valid id and species wherever it ends up', () => {
    const a = islands({}, { terrain: { waterFraction: 0.1 } });
    for (let t = 0; t < 200; t++) a.step();
    for (const sim of a.sims) {
      const ids = sim.creatures.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const c of sim.creatures) expect(sim.species.get(c.speciesId)).toBeDefined();
      expect(sim.species.list().reduce((n, s) => n + s.count, 0)).toBe(sim.creatures.length);
    }
  });

  it('announces arrivals on the island they reach', () => {
    const a = islands();
    a.migrate();
    for (const sim of a.sims) {
      expect(sim.events.events.some((e) => /^3 MIGRANTS ARRIVE FROM ISLAND \d$/.test(e.text))).toBe(
        true,
      );
    }
    expect(a.sims[1].events.events.at(-1)?.text).toBe('3 MIGRANTS ARRIVE FROM ISLAND 1');
  });

  it('does not count a departure as a death', () => {
    const a = islands();
    const deaths: string[] = [];
    a.sims.forEach((s) => (s.onDeath = (_, cause) => deaths.push(cause)));
    const before = a.sims.map((s) => s.stats.starved + s.stats.eaten + s.stats.diedOfAge);
    a.migrate();
    expect(deaths).toEqual([]);
    expect(a.sims.map((s) => s.stats.starved + s.stats.eaten + s.stats.diedOfAge)).toEqual(before);
  });

  it('sends only as many as an island has', () => {
    const a = islands(
      { islands: { count: 2, interval: 20, migrants: 5 } },
      { creatures: { initialCount: 2 } },
    );
    a.migrate();
    expect(a.sims[0].creatures).toHaveLength(2);
    expect(a.sims[1].creatures).toHaveLength(2);
    a.sims[0].creatures.length = 0;
    a.migrate();
    expect(a.sims[1].creatures.length).toBeLessThanOrEqual(2);
  });

  it('migrates on schedule and picks up rule changes made while running', () => {
    const a = islands({ islands: { count: 2, interval: 10, migrants: 1 } });
    let arrivals = 0;
    for (let t = 1; t <= 30; t++) {
      a.step();
      arrivals = a.sims[1].events.events.filter((e) => e.text.includes('MIGRANT ARRIVE')).length;
      if (t === 9) expect(arrivals).toBe(0);
    }
    expect(arrivals).toBe(3);
    for (const sim of a.sims) sim.config.islands.migrants = 0;
    for (let t = 0; t < 20; t++) a.step();
    expect(a.sims[1].events.events.filter((e) => e.text.includes('MIGRANT ARRIVE')).length).toBe(3);
  });

  it('is repeatable', () => {
    const run = () => {
      const a = islands();
      for (let t = 0; t < 120; t++) a.step();
      return a.sims.map((s) => s.creatures.map((c) => [c.id, c.x, c.energy]));
    };
    expect(run()).toEqual(run());
  });

  it('shares NEAT numbering between islands so migrants’ genes stay meaningful', () => {
    const a = islands({}, { brain: { type: 'neat', addNodeRate: 0.3, addConnectionRate: 0.3 } });
    expect(a.sims.every((s) => s.innovations === a.innovations)).toBe(true);
    for (let t = 0; t < 200; t++) a.step();
    for (const sim of a.sims)
      for (const c of sim.creatures) expect(c.brain.connectionCount).toBeGreaterThan(0);
  });

  it('is validated', () => {
    expect(() => resolveConfig({ islands: { count: 0 } })).toThrow(/islands.count/);
    expect(() => resolveConfig({ islands: { count: 9 } })).toThrow(/islands.count/);
    expect(() => resolveConfig({ islands: { interval: 0 } })).toThrow(/interval/);
    expect(() => resolveConfig({ islands: { migrants: -1 } })).toThrow(/migrants/);
  });
});

describe('saving islands', () => {
  it('carries on exactly, migration included', () => {
    const make = () => islands({}, { brain: { type: 'neat' } });
    const original = make();
    for (let t = 0; t < 130; t++) original.step();
    const text = saveArchipelagoToJson(original, 2);
    const { archipelago: loaded, active } = loadArchipelagoFromJson(text);
    expect(active).toBe(2);
    expect(saveArchipelagoToJson(loaded, 2)).toBe(text);
    for (let t = 0; t < 130; t++) {
      original.step();
      loaded.step();
    }
    expect(saveArchipelagoToJson(loaded, 2)).toBe(saveArchipelagoToJson(original, 2));
  });

  it('still reads a save from before islands existed, as one island', () => {
    const sim = new Simulation({ seed: 5, creatures: { initialCount: 30 } });
    for (let t = 0; t < 100; t++) sim.step();
    const { archipelago, active } = loadArchipelagoFromJson(saveToJson(sim));
    expect(archipelago.sims).toHaveLength(1);
    expect(active).toBe(0);
    for (let t = 0; t < 50; t++) {
      sim.step();
      archipelago.step();
    }
    expect(saveToJson(archipelago.sims[0])).toBe(saveToJson(sim));
  });

  it('refuses a damaged island save', () => {
    const a = islands();
    const good = JSON.parse(saveArchipelagoToJson(a));
    expect(() => loadArchipelagoFromJson('nope')).toThrow(/not valid JSON/);
    expect(() => loadArchipelagoFromJson(JSON.stringify({ ...good, islands: [] }))).toThrow(
      /no islands/,
    );
    expect(() => loadArchipelagoFromJson(JSON.stringify({ ...good, version: 7 }))).toThrow(
      /version 7/,
    );
    expect(() => loadArchipelagoFromJson(JSON.stringify({ ...good, rng: [1] }))).toThrow(/random/);
    const bad = JSON.parse(JSON.stringify(good));
    bad.islands[1].world.food = floatsToBase64(new Float32Array(3));
    expect(() => loadArchipelagoFromJson(JSON.stringify(bad))).toThrow(/map size/);
  });
});

describe('SimHost with islands', () => {
  const host = () =>
    new SimHost(
      resolveConfig({
        seed: 2,
        creatures: { initialCount: 30 },
        islands: { count: 3, interval: 15, migrants: 2 },
      }),
    );

  it('shows the active island and reports all of them', () => {
    const h = host();
    expect(h.scene.islands).toEqual({ count: 3, active: 0, populations: [30, 30, 30] });
    h.advance(100);
    h.refresh(false);
    expect(h.scene.islands.populations).toHaveLength(3);
  });

  it('switches islands, giving that island’s map and creatures', async () => {
    const h = host();
    const first = h.world.terrain.slice();
    await h.setIsland(1);
    expect(h.scene.islands.active).toBe(1);
    expect(h.world.terrain).not.toEqual(first);
    expect(h.scene.count).toBe(h.archipelago.sims[1].creatures.length);
    expect(h.scene.id[0]).toBe(h.archipelago.sims[1].creatures[0].id);
    await expect(h.setIsland(7)).rejects.toThrow(/no island 8/);
    expect(h.scene.islands.active).toBe(1);
  });

  it('applies rule changes to every island, and disasters only to the one on screen', async () => {
    const h = host();
    h.setConfig('creatures.eatRate', 3);
    expect(h.archipelago.sims.map((s) => s.config.creatures.eatRate)).toEqual([3, 3, 3]);
    h.trigger('drought');
    expect(h.archipelago.sims.map((s) => s.modifiers.length)).toEqual([1, 0, 0]);
    await h.setIsland(2);
    h.trigger('plague');
    expect(h.archipelago.sims[0].stats.disaster).toBe(0);
    expect(h.archipelago.sims[2].stats.disaster).toBeGreaterThan(0);
  });

  it('only reports effects from the island on screen', async () => {
    const h = host();
    h.setPaused(false);
    for (let i = 0; i < 200; i++) h.advance(20);
    h.refresh(false);
    const eventsFirst = h.scene.effects.length;
    await h.setIsland(1);
    expect(h.scene.effects).toEqual([]);
    expect(eventsFirst % 3).toBe(0);
  });

  it('saves and loads every island, and remembers which was on screen', async () => {
    const h = host();
    for (let i = 0; i < 60; i++) h.advance(20);
    await h.setIsland(2);
    const text = await h.save();
    await h.newWorld(resolveConfig({ seed: 99 }));
    expect(h.scene.islands.count).toBe(1);
    const settings = await h.load(text);
    expect(settings.islands.count).toBe(3);
    expect(h.scene.islands).toMatchObject({ count: 3, active: 2 });
    expect(h.detail).toBeNull();
  });
});

describe('islands through the worker', () => {
  it('switch islands on request', async () => {
    const worker: WorkerLike = {
      postMessage(command: Command) {
        runtime.handle(structuredClone(command));
      },
      onmessage: null,
    };
    const runtime = new WorkerRuntime(
      (reply: Reply) => worker.onmessage?.({ data: structuredClone(reply) }),
      0,
    );
    const backend = new WorkerBackend(
      worker,
      resolveConfig({ seed: 4, creatures: { initialCount: 20 }, islands: { count: 2 } }),
    );
    await backend.ready;
    runtime.pump(20);
    backend.update(16);
    expect(backend.scene.islands).toMatchObject({ count: 2, active: 0 });
    const firstMap = backend.world.terrain.slice();
    await backend.setIsland(1);
    expect(backend.world.terrain).not.toEqual(firstMap);
    runtime.pump(40);
    backend.update(16);
    expect(backend.scene.islands.active).toBe(1);
    await expect(backend.setIsland(5)).rejects.toThrow(/no island/);
  });
});
