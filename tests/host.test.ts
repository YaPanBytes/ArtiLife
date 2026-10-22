import { describe, expect, it } from 'vitest';
import { SimHost } from '../src/runtime/host';
import { EFFECT_BIRTH, EFFECT_DEATH, EFFECT_HIT } from '../src/runtime/types';
import { DEFAULT_CONFIG, resolveConfig } from '../src/sim/config';

const make = (overrides = {}, warmup = 0) =>
  new SimHost(resolveConfig({ seed: 5, ...overrides }), warmup);
const FRAME = 1000 / 60;

describe('SimHost scene', () => {
  it('mirrors the creatures into flat arrays', () => {
    const host = make({ creatures: { initialCount: 30 } });
    const { scene, sim } = host;
    expect(scene.count).toBe(30);
    expect(scene.tick).toBe(0);
    sim.creatures.forEach((c, i) => {
      expect(scene.id[i]).toBe(c.id);
      expect(scene.x[i]).toBeCloseTo(c.x, 4);
      expect(scene.y[i]).toBeCloseTo(c.y, 4);
      expect(scene.energy[i]).toBeCloseTo(c.energy, 4);
      expect(scene.hue[i]).toBeCloseTo(c.traits.hue, 5);
      expect(scene.diet[i]).toBeCloseTo(c.traits.diet, 5);
      expect(scene.species[i]).toBe(c.speciesId);
    });
    expect(scene.food.length).toBe(sim.world.food.length);
    expect(scene.maxFood).toBe(sim.config.food.maxPerTile);
    expect(host.world.terrain.length).toBe(sim.world.terrain.length);
  });

  it('follows the simulation as it runs, and finds creatures by id', () => {
    const host = make();
    for (let i = 0; i < 50; i++) host.sim.step();
    host.refresh(false);
    expect(host.scene.tick).toBe(50);
    expect(host.scene.count).toBe(host.sim.creatures.length);
    const target = host.sim.creatures[3];
    expect(host.scene.indexOfId(target.id)).toBe(3);
    expect(host.scene.indexOfId(-1)).toBe(-1);
  });

  it('reports births, deaths and bites as effects, once', () => {
    const host = make({ creatures: { initialCount: 80 } });
    host.setPaused(false);
    let kinds = new Set<number>();
    for (let i = 0; i < 400 && kinds.size < 3; i++) {
      host.update(FRAME);
      const e = host.scene.effects;
      expect(e.length % 3).toBe(0);
      for (let j = 0; j < e.length; j += 3) kinds.add(e[j]);
    }
    expect(kinds.has(EFFECT_BIRTH)).toBe(true);
    expect(kinds.has(EFFECT_DEATH)).toBe(true);
    host.setPaused(true);
    host.update(FRAME);
    expect(host.scene.effects).toEqual([]);
    kinds = new Set();
    expect([EFFECT_BIRTH, EFFECT_DEATH, EFFECT_HIT]).toEqual([0, 1, 2]);
  });
});

describe('SimHost running', () => {
  it('runs speed ticks per frame, and none while paused', () => {
    const host = make();
    host.setSpeed(4);
    expect(host.advance(FRAME)).toBe(4);
    host.setPaused(true);
    expect(host.advance(FRAME * 10)).toBe(0);
    host.setPaused(false);
    host.setSpeed(1);
    expect(host.advance(FRAME * 3)).toBe(3);
  });

  it('carries leftover time between frames', () => {
    const host = make();
    host.setSpeed(1);
    let total = 0;
    for (let i = 0; i < 10; i++) total += host.advance(FRAME / 2);
    expect(total).toBe(5);
  });

  it('does not try to make up a long stall', () => {
    const host = make();
    host.setSpeed(2);
    expect(host.advance(60 * FRAME)).toBeLessThanOrEqual(2 * 6);
  });

  it('steps one tick and pauses', () => {
    const host = make();
    host.stepOnce();
    expect(host.paused).toBe(true);
    expect(host.sim.tick).toBe(1);
  });

  it('measures its speed in ticks per second', () => {
    const host = make();
    host.setSpeed(2);
    for (let i = 0; i < 40; i++) host.update(FRAME);
    expect(host.scene.tps).toBeGreaterThan(90);
    expect(host.scene.tps).toBeLessThan(150);
  });
});

describe('SimHost rules and worlds', () => {
  it('applies a rule change to the running world and the pending settings only', () => {
    const host = make();
    host.setConfig('creatures.eatRate', 3);
    expect(host.sim.config.creatures.eatRate).toBe(3);
    expect(host.settings.creatures.eatRate).toBe(3);
    expect(DEFAULT_CONFIG.creatures.eatRate).not.toBe(3);
    expect(() => host.setConfig('creatures.nope', 1)).toThrow(/unknown/);
    expect(() => host.setConfig('creatures.eatRate', true)).toThrow(/boolean/);
  });

  it('starts a fresh world on request', () => {
    const host = make();
    for (let i = 0; i < 100; i++) host.sim.step();
    host.select(host.sim.creatures[0].id);
    const settings = resolveConfig({ seed: 9, terrain: { waterFraction: 0.3 } });
    host.newWorld(settings, 20);
    expect(host.sim.tick).toBe(20);
    expect(host.sim.config.seed).toBe(9);
    expect(host.scene.tick).toBe(20);
    expect(host.refresh(true)).toBeUndefined();
    expect(host.detail).toBeNull();
    const water = host.world.terrain.filter((t) => t === 1).length / host.world.terrain.length;
    expect(water).toBeCloseTo(0.3, 1);
  });

  it('is deterministic: the same settings give the same scene', () => {
    const a = make({}, 200);
    const b = make({}, 200);
    expect(Array.from(a.scene.x.subarray(0, a.scene.count))).toEqual(
      Array.from(b.scene.x.subarray(0, b.scene.count)),
    );
    expect(a.scene.stats).toEqual(b.scene.stats);
  });
});

describe('SimHost inspection', () => {
  it('describes the selected creature, brain included', () => {
    const host = make();
    const c = host.sim.creatures[2];
    host.select(c.id);
    host.refresh(false);
    const d = host.detail!;
    expect(d.id).toBe(c.id);
    expect(d.generation).toBe(0);
    expect(d.parentId).toBeNull();
    expect(d.traits.size).toBe(c.traits.size);
    expect(d.energy).toBe(c.energy);
    expect(d.brain.edgeWeight.length).toBeGreaterThan(0);
    host.select(null);
    host.refresh(false);
    expect(host.detail).toBeNull();
  });

  it('drops the selection when the creature dies', () => {
    const host = make({ creatures: { initialCount: 20, maxAge: 5 } });
    host.select(host.sim.creatures[0].id);
    for (let i = 0; i < 6; i++) host.sim.step();
    host.refresh(false);
    expect(host.detail).toBeNull();
  });

  it('refreshes the analysis at most every so often unless forced', () => {
    const host = make();
    host.refresh(true, 1000);
    const v = host.analysis.version;
    host.refresh(false, 1100);
    expect(host.analysis.version).toBe(v);
    host.refresh(false, 1300);
    expect(host.analysis.version).toBe(v + 1);
    host.refresh(true, 1301);
    expect(host.analysis.version).toBe(v + 2);
    expect(host.analysis.dietHistogram.length).toBe(10);
    expect(host.analysis.species.length).toBeGreaterThan(0);
  });
});
