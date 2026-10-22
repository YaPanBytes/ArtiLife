import { describe, expect, it } from 'vitest';
import { base64ToBytes, base64ToFloats, bytesToBase64, floatsToBase64 } from '../src/sim/base64';
import { Rng } from '../src/sim/rng';
import { loadFromJson, loadSimulation, saveSimulation, saveToJson } from '../src/sim/serialize';
import { Simulation } from '../src/sim/simulation';

const run = (sim: Simulation, ticks: number) => {
  for (let t = 0; t < ticks; t++) sim.step();
  return sim;
};
/** Two simulations are the same if everything a save records is the same. */
const same = (a: Simulation, b: Simulation) => expect(saveToJson(b)).toBe(saveToJson(a));

describe('base64', () => {
  it('round-trips bytes of every length, including padding cases', () => {
    const rng = new Rng(1);
    for (let n = 0; n < 40; n++) {
      const bytes = Uint8Array.from({ length: n }, () => rng.int(256));
      const text = bytesToBase64(bytes);
      expect(text.length % 4).toBe(0);
      expect(Array.from(base64ToBytes(text))).toEqual(Array.from(bytes));
    }
  });

  it('matches the standard encoding', () => {
    expect(bytesToBase64(new TextEncoder().encode('Man'))).toBe('TWFu');
    expect(bytesToBase64(new TextEncoder().encode('Ma'))).toBe('TWE=');
    expect(bytesToBase64(new TextEncoder().encode('M'))).toBe('TQ==');
    expect(Buffer.from('hello world!?').toString('base64')).toBe(
      bytesToBase64(new TextEncoder().encode('hello world!?')),
    );
  });

  it('round-trips floats exactly', () => {
    const f = Float32Array.from([0, -1.5, 3.14159, 1e-30, 1e30, NaN, Infinity]);
    const back = base64ToFloats(floatsToBase64(f));
    expect(Array.from(back)).toEqual(Array.from(f));
  });

  it('rejects text that is not base64', () => {
    expect(() => base64ToBytes('abc')).toThrow(/multiple of 4/);
    expect(() => base64ToBytes('ab!d')).toThrow(/unexpected character/);
    expect(() => base64ToFloats(bytesToBase64(new Uint8Array(3)))).toThrow(/wrong length/);
  });
});

describe('save and load', () => {
  it('carries on exactly where the run left off', () => {
    const original = run(new Simulation({ seed: 2, creatures: { initialCount: 80 } }), 400);
    const loaded = loadFromJson(saveToJson(original));
    same(original, loaded);
    run(original, 300);
    run(loaded, 300);
    expect(loaded.tick).toBe(700);
    same(original, loaded);
    expect(original.creatures.length).toBeGreaterThan(0);
  });

  it('carries on exactly with every feature switched on', () => {
    const make = () =>
      new Simulation({
        seed: 5,
        creatures: { initialCount: 100, sexual: true, mateRange: 2.5 },
        food: { seasons: { enabled: true, lengthTicks: 600, coldCost: 0.5 } },
        terrain: { barrier: 'river', barrierGaps: 2 },
      });
    const original = make();
    run(original, 150);
    original.trigger('drought');
    original.trigger('hunters');
    run(original, 150);
    const loaded = loadFromJson(saveToJson(original));
    same(original, loaded);
    expect(loaded.modifiers).toHaveLength(1);
    run(original, 400);
    run(loaded, 400);
    same(original, loaded);
    expect(original.stats.births).toBeGreaterThan(0);
  });

  it('is exactly reproduced when saved again after loading', () => {
    const original = run(new Simulation({ seed: 3 }), 300);
    const text = saveToJson(original);
    expect(saveToJson(loadFromJson(text))).toBe(text);
  });

  it('is a snapshot: later steps do not change what was saved', () => {
    const sim = run(new Simulation({ seed: 4 }), 100);
    const saved = saveSimulation(sim);
    const before = JSON.stringify(saved);
    run(sim, 100);
    expect(JSON.stringify(saved)).toBe(before);
  });

  it('restores the run’s settings, history, events and species', () => {
    const original = run(new Simulation({ seed: 6, creatures: { initialCount: 70 } }), 600);
    const loaded = loadFromJson(saveToJson(original));
    expect(loaded.config).toEqual(original.config);
    expect(loaded.config.creatures.initialCount).toBe(70);
    expect(loaded.history.data().length).toBe(original.history.data().length);
    expect(loaded.events.events).toEqual(original.events.events);
    expect(loaded.species.list()).toEqual(original.species.list());
    expect(loaded.stats).toEqual(original.stats);
    expect(loaded.world.food).toEqual(original.world.food);
    expect(loaded.creatures.map((c) => c.id)).toEqual(original.creatures.map((c) => c.id));
  });

  it('keeps announcements from repeating after a load', () => {
    const original = run(new Simulation({ seed: 2 }), 500);
    const loaded = loadFromJson(saveToJson(original));
    const count = loaded.events.events.length;
    run(loaded, 1);
    expect(loaded.events.events.slice(0, count)).toEqual(original.events.events);
    expect(
      loaded.events.events.filter((e) => e.text === 'THE FIRST HUNTERS APPEAR').length,
    ).toBeLessThanOrEqual(1);
  });

  it('handles a run with no creatures left', () => {
    const sim = new Simulation({ seed: 1, creatures: { initialCount: 0 } });
    run(sim, 20);
    const loaded = loadFromJson(saveToJson(sim));
    expect(loaded.creatures).toHaveLength(0);
    same(sim, loaded);
  });

  it('stays a reasonable size', () => {
    const sim = run(new Simulation({ seed: 2 }), 1000);
    expect(saveToJson(sim).length).toBeLessThan(3_000_000);
  });
});

describe('loading a bad save', () => {
  const good = () =>
    JSON.parse(saveToJson(run(new Simulation({ seed: 1, creatures: { initialCount: 10 } }), 20)));

  it('explains what is wrong', () => {
    expect(() => loadFromJson('not json')).toThrow(/not valid JSON/);
    expect(() => loadSimulation(null)).toThrow(/not an object/);
    expect(() => loadSimulation({ format: 'other' })).toThrow(/not an ArtiLife save/);
    expect(() => loadSimulation({ format: 'artilife', version: 99 })).toThrow(/version 99/);
  });

  it('notices missing parts and wrong sizes', () => {
    const missing = good();
    delete missing.species;
    expect(() => loadSimulation(missing)).toThrow(/missing "species"/);

    const wrongMap = good();
    wrongMap.config.world.width = 10;
    expect(() => loadSimulation(wrongMap)).toThrow(/map size/);

    const wrongRng = good();
    wrongRng.rng = [1, 2];
    expect(() => loadSimulation(wrongRng)).toThrow(/random number state/);

    const wrongGenome = good();
    wrongGenome.creatures[0].genome = floatsToBase64(new Float32Array(5));
    expect(() => loadSimulation(wrongGenome)).toThrow(/genes, expected/);

    const badRef = good();
    badRef.creatures[0].ref = 9999;
    expect(() => loadSimulation(badRef)).toThrow(/unknown genome reference/);
  });

  it('rejects settings that would not be valid', () => {
    const bad = good();
    bad.config.food.maxPerTile = -1;
    expect(() => loadSimulation(bad)).toThrow(/maxPerTile/);
  });
});
