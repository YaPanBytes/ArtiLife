import { describe, expect, it } from 'vitest';
import { BRAIN_LAYOUT, OUT_BITE } from '../src/sim/brain';
import { resolveConfig } from '../src/sim/config';
import { appetite, meatEfficiency, plantEfficiency } from '../src/sim/energy';
import { TRAIT_COUNT, TRAIT_ORDER, randomGenome } from '../src/sim/genome';
import { Rng } from '../src/sim/rng';
import { RAY_CHANNELS, RAY_COUNT, SENSE_INPUT_COUNT } from '../src/sim/senses';
import { Simulation } from '../src/sim/simulation';
import { SpatialHash } from '../src/sim/spatial-hash';
import { findBiteTarget } from '../src/sim/predation';
import { emptyWorld, lifeSim, makeCreature } from './helpers';

/** Make a creature's brain always bite (the bite output saturates near +1). */
function biter(c: ReturnType<typeof makeCreature>) {
  c.genome[TRAIT_COUNT + BRAIN_LAYOUT.B2 + OUT_BITE] = 5;
  return c;
}

/** A free-of-upkeep world, so energy changes come only from the thing being tested. */
const bareSim = (overrides = {}) =>
  lifeSim({ creatures: { basalCost: 0, moveCost: 0, senseCost: 0, maxAge: 0 }, ...overrides });

describe('diet', () => {
  const { config } = emptyWorld();

  it('splits digestion between plants and meat, with plant digestion falling by the trade-off', () => {
    const herbivore = makeCreature(5, 5, 0, { diet: 0 });
    const omnivore = makeCreature(5, 5, 0, { diet: 0.5 });
    const carnivore = makeCreature(5, 5, 0, { diet: 1 });
    expect(config.predation.dietTradeoff).toBe(0.5);
    expect([plantEfficiency(herbivore, config), meatEfficiency(herbivore)]).toEqual([1, 0]);
    expect(plantEfficiency(omnivore, config)).toBeCloseTo(0.75, 9);
    expect(meatEfficiency(omnivore)).toBe(0.5);
    expect(plantEfficiency(carnivore, config)).toBeCloseTo(0.5, 9);
    expect(meatEfficiency(carnivore)).toBe(1);
  });

  it('lets a full trade-off make a carnivore unable to eat plants at all', () => {
    const strict = emptyWorld({ predation: { dietTradeoff: 1 } }).config;
    expect(appetite(makeCreature(5, 5, 0, { diet: 1 }, 10), strict)).toBe(0);
  });

  it('gives an omnivore proportionally less energy from the same plants', () => {
    const sim = bareSim();
    const herbivore = makeCreature(5.5, 5.5, 0, { size: 1, diet: 0 }, 10);
    const omnivore = makeCreature(9.5, 9.5, 0, { size: 1, diet: 0.5 }, 10);
    sim.creatures.push(herbivore, omnivore);
    sim.world.food[sim.world.tileIndex(5, 5)] = 10;
    sim.world.food[sim.world.tileIndex(9, 9)] = 10;
    sim['eatPhase']();
    expect(herbivore.energy).toBeCloseTo(12, 9);
    expect(omnivore.energy).toBeCloseTo(10 + 2 * 0.75, 9);
  });

  it('starts founders mostly as plant eaters', () => {
    const rng = new Rng(4);
    const diet = TRAIT_ORDER.indexOf('diet');
    const diets = Array.from({ length: 500 }, () => randomGenome(rng)[diet]);
    expect(diets.every((d) => d >= 0 && d <= 1)).toBe(true);
    expect(diets.reduce((a, b) => a + b, 0) / diets.length).toBeLessThan(0.35);
  });
});

describe('findBiteTarget', () => {
  const { world, config } = emptyWorld();
  const find = (
    subject: ReturnType<typeof makeCreature>,
    others: ReturnType<typeof makeCreature>[],
  ) => {
    const all = [subject, ...others];
    const hash = new SpatialHash(world.width, world.height, 10);
    hash.build(
      all.map((c) => c.x),
      all.map((c) => c.y),
      all.length,
    );
    return findBiteTarget(subject, all, hash, world, config, []);
  };

  it('picks the nearest creature in front, within reach', () => {
    const subject = makeCreature(10, 10, 0);
    const near = makeCreature(10.6, 10);
    const farther = makeCreature(11.1, 10);
    expect(find(subject, [farther, near])).toBe(near);
  });

  it('ignores creatures out of reach, behind, or outside the cone', () => {
    const subject = makeCreature(10, 10, 0);
    expect(find(subject, [makeCreature(12, 10)])).toBeNull(); // too far (range 1.2)
    expect(find(subject, [makeCreature(9.2, 10)])).toBeNull(); // behind
    expect(find(subject, [makeCreature(10, 10.9)])).toBeNull(); // 90 degrees off, cone is ~52
    expect(find(subject, [makeCreature(10.7, 10.4)])).not.toBeNull(); // ~30 degrees off
  });

  it('never targets itself, and works across the map seam', () => {
    const subject = makeCreature(0.3, 10, Math.PI); // facing -x, so the seam is ahead
    expect(find(subject, [])).toBeNull();
    const prey = makeCreature(world.width - 0.4, 10);
    expect(find(subject, [prey])).toBe(prey);
  });
});

describe('bites', () => {
  it('move energy from victim to biter, digested by diet, and cost the biter energy', () => {
    const sim = bareSim();
    const wolf = biter(makeCreature(10, 10, 0, { size: 0.5, diet: 1 }, 50)); // size 1.25
    const deer = makeCreature(10.8, 10, 0, { diet: 0 }, 50);
    sim.creatures.push(wolf, deer);
    sim.step();
    const { biteDamage, biteCost, meatYield } = sim.config.predation;
    const damage = biteDamage * 1.25;
    expect(deer.energy).toBeCloseTo(50 - damage, 9);
    expect(wolf.energy).toBeCloseTo(50 - biteCost + damage * meatYield, 9);
    expect(deer.hurt).toBe(1);
    expect(wolf.hurt).toBe(0);
    expect(sim.stats.bites).toBe(1);
  });

  it('give a plant eater nothing for its trouble, but still hurt the victim', () => {
    const sim = bareSim();
    const biterHerbivore = biter(makeCreature(10, 10, 0, { diet: 0 }, 50));
    const other = makeCreature(10.8, 10, 0, { diet: 0 }, 50);
    sim.creatures.push(biterHerbivore, other);
    sim.step();
    expect(biterHerbivore.energy).toBeCloseTo(50 - sim.config.predation.biteCost, 9);
    expect(other.energy).toBeLessThan(50);
  });

  it('cost energy even when nothing is in reach', () => {
    const sim = bareSim();
    const c = biter(makeCreature(10, 10, 0, { diet: 1 }, 50));
    sim.creatures.push(c);
    sim.step();
    expect(c.energy).toBeCloseTo(50 - sim.config.predation.biteCost, 9);
    expect(sim.stats.bites).toBe(0);
  });

  it('never fill a creature past the energy cap', () => {
    const sim = bareSim();
    const wolf = biter(makeCreature(10, 10, 0, { diet: 1 }, 99));
    sim.creatures.push(wolf, makeCreature(10.8, 10, 0, {}, 50));
    sim.step();
    expect(wolf.energy).toBe(sim.config.creatures.maxEnergy);
  });

  it('kill a victim with too little energy, and the biters share what it had', () => {
    const sim = bareSim();
    const a = biter(makeCreature(10, 10, 0, { size: 0, diet: 1 }, 50)); // size 0.5: planned damage 5
    const b = biter(makeCreature(11.2, 10, Math.PI, { size: 1, diet: 1 }, 50)); // size 2: planned damage 20
    const prey = makeCreature(10.6, 10, 0, { diet: 0 }, 5);
    sim.creatures.push(a, b, prey);
    const deaths: string[] = [];
    sim.onDeath = (_, cause) => deaths.push(cause);
    sim.step();
    const { biteCost, meatYield } = sim.config.predation;
    // 5 energy is split 5:20 between the two biters.
    expect(a.energy).toBeCloseTo(50 - biteCost + 1 * meatYield, 9);
    expect(b.energy).toBeCloseTo(50 - biteCost + 4 * meatYield, 9);
    expect(deaths).toEqual(['eaten']);
    expect(sim.stats.eaten).toBe(1);
    expect(sim.stats.starved).toBe(0);
    expect(sim.creatures).not.toContain(prey);
  });

  it('give the same result whatever order the creatures are stored in', () => {
    const run = (reverse: boolean) => {
      const sim = bareSim();
      const a = biter(makeCreature(10, 10, 0, { size: 0, diet: 1 }, 50));
      const b = biter(makeCreature(11.2, 10, Math.PI, { size: 1, diet: 1 }, 50));
      const prey = makeCreature(10.6, 10, 0, { diet: 0 }, 7);
      sim.creatures.push(...(reverse ? [prey, b, a] : [a, b, prey]));
      sim.step();
      return [a.energy, b.energy];
    };
    const forward = run(false);
    const backward = run(true);
    expect(backward[0]).toBeCloseTo(forward[0], 9);
    expect(backward[1]).toBeCloseTo(forward[1], 9);
  });

  it('are felt on the next tick through the hurt input', () => {
    const sim = bareSim();
    const wolf = biter(makeCreature(10, 10, 0, { diet: 1 }, 50));
    const deer = makeCreature(10.8, 10, 0, { diet: 0 }, 50);
    sim.creatures.push(wolf, deer);
    sim.step();
    sim.step();
    expect(deer.inputs[RAY_COUNT * RAY_CHANNELS + 3]).toBe(1);
    expect(wolf.inputs[RAY_COUNT * RAY_CHANNELS + 3]).toBe(0);
  });

  it('let creatures see how toothy others are', () => {
    const sim = bareSim();
    const watcher = makeCreature(10, 10, 0, { diet: 0 }, 50);
    const wolf = makeCreature(13, 10, 0, { diet: 1 }, 50);
    sim.creatures.push(watcher, wolf);
    sim.step();
    const middleRay = Math.floor(RAY_COUNT / 2);
    expect(watcher.inputs[middleRay * RAY_CHANNELS + 4]).toBe(1);
    expect(SENSE_INPUT_COUNT).toBe(RAY_COUNT * RAY_CHANNELS + 4);
  });

  it('can never create energy: with no food, total energy only falls', () => {
    const sim = new Simulation({
      seed: 6,
      food: { initialFill: 0, regrowRate: 0 },
      creatures: { initialCount: 150, startEnergy: 80, maxAge: 0 },
      predation: { biteDamage: 25 },
    });
    // Make a third of the founders hungry carnivores that always bite.
    sim.creatures.forEach((c, i) => {
      if (i % 3 === 0) {
        c.genome[TRAIT_ORDER.indexOf('diet')] = 1;
        Object.assign(c.traits, { diet: 1 });
        biter(c);
      }
    });
    let total = sim.creatures.reduce((sum, c) => sum + c.energy, 0);
    for (let t = 0; t < 150; t++) {
      sim.step();
      const now = sim.creatures.reduce((sum, c) => sum + c.energy, 0);
      expect(now).toBeLessThanOrEqual(total + 1e-6);
      total = now;
    }
    expect(sim.stats.bites).toBeGreaterThan(0);
  });
});

describe('predation config', () => {
  it('is validated', () => {
    expect(() => resolveConfig({ predation: { biteRange: 0 } })).toThrow(/biteRange/);
    expect(() => resolveConfig({ predation: { biteArc: 4 } })).toThrow(/biteArc/);
    expect(() => resolveConfig({ predation: { meatYield: 1.5 } })).toThrow(/meatYield/);
    expect(() => resolveConfig({ predation: { biteCost: -1 } })).toThrow(/biteCost/);
    expect(resolveConfig({ predation: { biteDamage: 0 } }).predation.biteDamage).toBe(0);
  });
});
