import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/sim/config';
import { Rng } from '../src/sim/rng';
import { Terrain, World } from '../src/sim/world';

const make = (overrides = {}) => {
  const config = resolveConfig(overrides);
  return { config, world: new World(config, new Rng(config.seed)) };
};

describe('World generation', () => {
  it('is deterministic for a given seed and differs between seeds', () => {
    const a = make({ seed: 3 }).world;
    const b = make({ seed: 3 }).world;
    const c = make({ seed: 4 }).world;
    expect(a.terrain).toEqual(b.terrain);
    expect(a.food).toEqual(b.food);
    expect(a.terrain).not.toEqual(c.terrain);
  });

  it('hits the requested water and rock fractions', () => {
    const { world, config } = make({ terrain: { waterFraction: 0.2, rockFraction: 0.1 } });
    const total = config.world.width * config.world.height;
    const count = (t: Terrain) => world.terrain.filter((v) => v === t).length;
    expect(count(Terrain.Water) / total).toBeCloseTo(0.2, 1);
    expect(count(Terrain.Rock) / total).toBeCloseTo(0.1, 1);
  });

  it('makes everything ground when fractions are zero', () => {
    const { world } = make({ terrain: { waterFraction: 0, rockFraction: 0 } });
    expect(world.terrain.every((t) => t === Terrain.Ground)).toBe(true);
  });

  it('has no fertility or food on water and rock', () => {
    const { world } = make();
    for (let i = 0; i < world.terrain.length; i++) {
      if (world.terrain[i] !== Terrain.Ground) {
        expect(world.fertility[i]).toBe(0);
        expect(world.food[i]).toBe(0);
      }
    }
  });

  it('is uniformly fertile with zero contrast', () => {
    const { world } = make({ terrain: { fertilityContrast: 0 } });
    for (let i = 0; i < world.terrain.length; i++) {
      if (world.terrain[i] === Terrain.Ground) expect(world.fertility[i]).toBe(1);
    }
  });
});

describe('World geometry', () => {
  const { world } = make({ world: { width: 10, height: 8 } });

  it('wraps tile indices and coordinates', () => {
    expect(world.tileIndex(10.5, 0)).toBe(world.tileIndex(0.5, 0));
    expect(world.tileIndex(-0.5, -0.5)).toBe(7 * 10 + 9);
    expect(world.wrapX(-1)).toBe(9);
    expect(world.wrapY(9)).toBe(1);
  });

  it('finds the shortest delta across the seam', () => {
    expect(world.deltaX(9, 1)).toBe(2);
    expect(world.deltaX(1, 9)).toBe(-2);
    expect(world.deltaY(0.5, 7.5)).toBe(-1);
    expect(world.distanceSq(0.5, 0.5, 9.5, 7.5)).toBe(2);
  });
});

describe('Food field', () => {
  it('regrows towards the cap but never above it', () => {
    const { world, config } = make({
      terrain: { waterFraction: 0, rockFraction: 0, fertilityContrast: 0 },
      food: { initialFill: 0, regrowRate: 1, maxPerTile: 5 },
    });
    expect(world.food.every((f) => f === 0)).toBe(true);
    world.stepFood(0);
    expect(world.food.every((f) => f === 1)).toBe(true);
    for (let t = 1; t < 20; t++) world.stepFood(t);
    expect(world.food.every((f) => f === config.food.maxPerTile)).toBe(true);
  });

  it('regrows faster on fertile tiles', () => {
    const { world } = make({ food: { initialFill: 0, regrowRate: 0.01 } });
    world.stepFood(0);
    let low = -1;
    let high = -1;
    for (let i = 0; i < world.food.length; i++) {
      if (world.fertility[i] === 0) continue;
      if (low < 0 || world.fertility[i] < world.fertility[low]) low = i;
      if (high < 0 || world.fertility[i] > world.fertility[high]) high = i;
    }
    expect(world.food[high]).toBeGreaterThan(world.food[low]);
  });

  it('eat removes food and never takes more than is there', () => {
    const { world } = make({
      terrain: { waterFraction: 0, rockFraction: 0, fertilityContrast: 0 },
      food: { initialFill: 0.5, maxPerTile: 10 },
    });
    expect(world.eat(2.3, 4.7, 3)).toBe(3);
    expect(world.foodAt(2.3, 4.7)).toBe(2);
    expect(world.eat(2.3, 4.7, 100)).toBe(2);
    expect(world.foodAt(2.3, 4.7)).toBe(0);
    expect(world.eat(2.3, 4.7, -5)).toBe(0);
  });

  it('swings regrowth with the seasons when enabled', () => {
    const { world } = make({
      food: { seasons: { enabled: true, lengthTicks: 400, amplitude: 0.5 } },
    });
    expect(world.seasonFactor(0)).toBeCloseTo(1);
    expect(world.seasonFactor(100)).toBeCloseTo(1.5);
    expect(world.seasonFactor(300)).toBeCloseTo(0.5);
    expect(make().world.seasonFactor(100)).toBe(1);
  });
});
