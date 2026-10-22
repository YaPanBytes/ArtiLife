import { describe, expect, it } from 'vitest';
import { BRAIN_LAYOUT, OUT_REPRODUCE } from '../src/sim/brain';
import { appetite, upkeep } from '../src/sim/energy';
import { TRAIT_COUNT } from '../src/sim/genome';
import { lifeSim, makeCreature } from './helpers';

/** Make a creature's brain always want to reproduce (the reproduce output saturates near +1). */
function wantsToReproduce(c: ReturnType<typeof makeCreature>) {
  c.genome[TRAIT_COUNT + BRAIN_LAYOUT.B2 + OUT_REPRODUCE] = 5;
  return c;
}

describe('energy', () => {
  const sim = lifeSim();
  const { config } = sim;

  it('charges upkeep for being alive, moving and seeing', () => {
    const c = makeCreature(5, 5, 0, { size: 0.5, visionRange: 0.5 }); // size 1.25, range 6
    c.speed = 0;
    const idle = config.creatures.basalCost * 1.25 + config.creatures.senseCost * 6;
    expect(upkeep(c, config)).toBeCloseTo(idle, 9);
    c.speed = 0.2;
    expect(upkeep(c, config)).toBeCloseTo(idle + config.creatures.moveCost * 0.04 * 1.25, 9);
  });

  it('charges more for being big, fast and far-sighted', () => {
    const base = makeCreature(5, 5, 0, { size: 0, visionRange: 0 });
    const big = makeCreature(5, 5, 0, { size: 1, visionRange: 0 });
    const seer = makeCreature(5, 5, 0, { size: 0, visionRange: 1 });
    expect(upkeep(big, config)).toBeGreaterThan(upkeep(base, config));
    expect(upkeep(seer, config)).toBeGreaterThan(upkeep(base, config));
    base.speed = 0.3;
    expect(upkeep(base, config)).toBeGreaterThan(
      upkeep(makeCreature(5, 5, 0, { size: 0, visionRange: 0 }), config),
    );
  });

  it('lets bigger creatures eat more, but never beyond the energy cap', () => {
    const small = makeCreature(5, 5, 0, { size: 0 }, 10);
    const large = makeCreature(5, 5, 0, { size: 1 }, 10);
    expect(appetite(large, config)).toBeGreaterThan(appetite(small, config));
    const nearlyFull = makeCreature(5, 5, 0, { size: 1 }, config.creatures.maxEnergy - 0.1);
    expect(appetite(nearlyFull, config)).toBeCloseTo(0.1, 9);
    expect(appetite(makeCreature(5, 5, 0, {}, config.creatures.maxEnergy), config)).toBe(0);
  });
});

describe('eating', () => {
  it('moves energy from the tile to the creature without creating or losing any', () => {
    const sim = lifeSim();
    const c = makeCreature(5.5, 5.5, 0, { size: 0.5 }, 20);
    sim.creatures.push(c);
    const tile = sim.world.tileIndex(5, 5);
    sim.world.food[tile] = 8;
    sim['eatPhase']();
    const gained = c.energy - 20;
    expect(gained).toBeGreaterThan(0);
    expect(gained + (sim.world.food[tile] - 8)).toBeCloseTo(0, 9);
  });

  it('only eats what the tile has', () => {
    const sim = lifeSim();
    const c = makeCreature(5.5, 5.5, 0, { size: 1 }, 20); // appetite 2
    sim.creatures.push(c);
    sim.world.food[sim.world.tileIndex(5, 5)] = 0.5;
    sim['eatPhase']();
    expect(c.energy).toBeCloseTo(20.5, 9);
    expect(sim.world.foodAt(5, 5)).toBe(0);
  });

  it('shares scarce food in proportion to appetite, whatever the order', () => {
    const run = (reverse: boolean) => {
      const sim = lifeSim();
      const small = makeCreature(5.5, 5.5, 0, { size: 0 }, 10); // appetite 0.5
      const large = makeCreature(5.2, 5.8, 0, { size: 1 }, 10); // appetite 2
      sim.creatures.push(...(reverse ? [large, small] : [small, large]));
      sim.world.food[sim.world.tileIndex(5, 5)] = 1;
      sim['eatPhase']();
      return { small: small.energy - 10, large: large.energy - 10, left: sim.world.foodAt(5, 5) };
    };
    const forward = run(false);
    const backward = run(true);
    expect(forward.small).toBeCloseTo(0.2, 9);
    expect(forward.large).toBeCloseTo(0.8, 9);
    expect(forward.left).toBeCloseTo(0, 9);
    expect(backward.small).toBeCloseTo(forward.small, 9);
    expect(backward.large).toBeCloseTo(forward.large, 9);
  });

  it('lets creatures on different tiles eat independently', () => {
    const sim = lifeSim();
    const a = makeCreature(5.5, 5.5, 0, { size: 1 }, 10);
    const b = makeCreature(9.5, 9.5, 0, { size: 1 }, 10);
    sim.creatures.push(a, b);
    sim.world.food[sim.world.tileIndex(5, 5)] = 10;
    sim['eatPhase']();
    expect(a.energy).toBeCloseTo(12, 9);
    expect(b.energy).toBe(10);
  });
});

describe('death', () => {
  it('starves when energy runs out', () => {
    const sim = lifeSim();
    sim.creatures.push(makeCreature(5, 5, 0, {}, 0.01));
    sim.step();
    expect(sim.creatures.length).toBe(0);
    expect(sim.stats.starved).toBe(1);
  });

  it('dies of old age at maxAge', () => {
    const sim = lifeSim({ creatures: { maxAge: 5 } });
    sim.creatures.push(makeCreature(5, 5, 0, {}, 100));
    for (let i = 0; i < 4; i++) sim.step();
    expect(sim.creatures.length).toBe(1);
    sim.step();
    expect(sim.creatures.length).toBe(0);
    expect(sim.stats.diedOfAge).toBe(1);
  });

  it('never dies of old age when maxAge is 0', () => {
    const sim = lifeSim({ creatures: { maxAge: 0 } });
    const c = makeCreature(5, 5, 0, {}, 100);
    sim.creatures.push(c);
    for (let i = 0; i < 100; i++) {
      c.energy = 100;
      sim.step();
    }
    expect(sim.creatures.length).toBe(1);
  });
});

describe('reproduction', () => {
  it('produces a child that carries energy, lineage and a mutated genome', () => {
    const sim = lifeSim({ mutation: { rateMultiplier: 0 } });
    const parent = wantsToReproduce(makeCreature(10, 10, 0, { reproThreshold: 0 }, 80));
    sim.creatures.push(parent);
    sim.step();
    expect(sim.creatures.length).toBe(2);
    const child = sim.creatures[1];
    const { birthCost, birthEfficiency } = sim.config.creatures;
    expect(child.parentId).toBe(parent.id);
    expect(child.generation).toBe(1);
    expect(child.energy).toBeCloseTo(birthCost * birthEfficiency, 9);
    expect(child.genome).not.toBe(parent.genome);
    expect(child.genome).toEqual(parent.genome);
    expect(parent.energy).toBeLessThan(80 - birthCost);
    expect(sim.stats.births).toBe(1);
  });

  it('only reproduces when the brain asks, and with enough energy', () => {
    const sim = lifeSim();
    sim.creatures.push(makeCreature(10, 10, 0, { reproThreshold: 0 }, 90)); // brain says no
    sim.creatures.push(wantsToReproduce(makeCreature(20, 20, 0, { reproThreshold: 0 }, 45))); // below 50
    sim.step();
    expect(sim.creatures.length).toBe(2);
    expect(sim.stats.births).toBe(0);
  });

  it('respects a creature’s own reproduction threshold', () => {
    const sim = lifeSim();
    sim.creatures.push(wantsToReproduce(makeCreature(10, 10, 0, { reproThreshold: 1 }, 90)));
    sim.step();
    expect(sim.stats.births).toBe(0);
  });

  it('stops at the population cap', () => {
    const sim = lifeSim({ creatures: { maxPopulation: 3 } });
    for (let i = 0; i < 3; i++) {
      sim.creatures.push(
        wantsToReproduce(makeCreature(5 + i * 5, 5, 0, { reproThreshold: 0 }, 90)),
      );
    }
    sim.step();
    expect(sim.creatures.length).toBe(3);
    sim.creatures.length = 2;
    sim.step();
    expect(sim.creatures.length).toBe(3);
  });

  it('places a child on walkable ground close to its parent', () => {
    const sim = lifeSim();
    for (let i = 0; i < 20; i++) {
      sim.creatures.length = 0;
      sim.creatures.push(wantsToReproduce(makeCreature(10, 10, 0, { reproThreshold: 0 }, 90)));
      sim.step();
      const [parent, child] = sim.creatures;
      expect(sim.world.isWalkable(child.x, child.y)).toBe(true);
      expect(sim.world.distanceSq(parent.x, parent.y, child.x, child.y)).toBeLessThan(2.5 * 2.5);
    }
  });
});

describe('energy conservation', () => {
  it('never creates energy when there is no food', () => {
    const sim = lifeSim({ creatures: { initialCount: 0 } });
    for (let i = 0; i < 10; i++) {
      sim.creatures.push(
        wantsToReproduce(makeCreature(3 * i + 1, 3 * i + 1, i, { reproThreshold: 0 }, 99)),
      );
    }
    let total = sim.creatures.reduce((sum, c) => sum + c.energy, 0);
    for (let t = 0; t < 300; t++) {
      sim.step();
      const now = sim.creatures.reduce((sum, c) => sum + c.energy, 0);
      expect(now).toBeLessThanOrEqual(total + 1e-9);
      total = now;
    }
    expect(sim.stats.births).toBeGreaterThan(0);
  });
});
