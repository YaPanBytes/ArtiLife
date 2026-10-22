import { describe, expect, it } from 'vitest';
import { BRAIN_LAYOUT, OUT_REPRODUCE, OUT_SIGNAL } from '../src/sim/brain';
import { resolveConfig } from '../src/sim/config';
import { upkeep } from '../src/sim/energy';
import { TRAIT_COUNT, crossover, setDiet } from '../src/sim/genome';
import { Rng } from '../src/sim/rng';
import { RAY_CHANNELS, RAY_COUNT } from '../src/sim/senses';
import { Simulation } from '../src/sim/simulation';
import { Terrain, World } from '../src/sim/world';
import { SimHost } from '../src/runtime/host';
import { lifeSim, makeCreature } from './helpers';

/** Number of separate regions of walkable ground on the wrap-around map. */
function regions(world: World): number[] {
  const { width, height } = world;
  const seen = new Uint8Array(width * height);
  const sizes: number[] = [];
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || world.terrain[start] !== Terrain.Ground) continue;
    let size = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % width;
      const y = Math.floor(i / width);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const j = ((y + dy + height) % height) * width + ((x + dx + width) % width);
        if (!seen[j] && world.terrain[j] === Terrain.Ground) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}

const flat = (terrain = {}) =>
  new World(
    resolveConfig({ seed: 3, terrain: { waterFraction: 0, rockFraction: 0, ...terrain } }),
    new Rng(3),
  );

describe('terrain barriers', () => {
  it('leave the world alone when off', () => {
    expect(regions(flat({ barrier: 'none' }))).toEqual([64 * 64]);
  });

  it('split the wrapped-around map into as many regions as there are barriers, when sealed', () => {
    for (const count of [2, 3, 4]) {
      const sizes = regions(flat({ barrier: 'river', barrierCount: count, barrierGaps: 0 }));
      expect(sizes).toHaveLength(count);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(64 * 64 - count * 2 * 64);
    }
  });

  it('are crossable at their gaps', () => {
    expect(regions(flat({ barrier: 'wall', barrierCount: 2, barrierGaps: 3 }))).toHaveLength(1);
  });

  it('are made of water for a river and rock for a wall, with no food on them', () => {
    for (const [barrier, terrain] of [
      ['river', Terrain.Water],
      ['wall', Terrain.Rock],
    ] as const) {
      const world = flat({ barrier, barrierCount: 2, barrierGaps: 0 });
      const blocked = world.terrain.filter((t) => t === terrain).length;
      expect(blocked).toBe(2 * 2 * 64);
      for (let i = 0; i < world.terrain.length; i++) {
        if (world.terrain[i] === terrain) {
          expect(world.food[i]).toBe(0);
          expect(world.fertility[i]).toBe(0);
        }
      }
    }
  });

  it('are the same every time for a seed', () => {
    const a = flat({ barrier: 'river', barrierGaps: 4 });
    const b = flat({ barrier: 'river', barrierGaps: 4 });
    expect(a.terrain).toEqual(b.terrain);
  });

  it('are validated', () => {
    expect(() => resolveConfig({ terrain: { barrier: 'moat' } })).toThrow(/barrier/);
    expect(() => resolveConfig({ terrain: { barrierCount: 0 } })).toThrow(/barrierCount/);
    expect(() => resolveConfig({ terrain: { barrierGaps: -1 } })).toThrow(/barrierGaps/);
  });

  it('keep creatures on their own side when sealed', () => {
    const sim = new Simulation({
      seed: 2,
      terrain: {
        barrier: 'wall',
        barrierCount: 2,
        barrierGaps: 0,
        waterFraction: 0,
        rockFraction: 0,
      },
      creatures: { initialCount: 60 },
    });
    const home = new Map(sim.creatures.map((c) => [c.id, Math.floor(c.x / 32)]));
    // Barriers sit at x=16 and x=48, so the two regions are x in [18, 48) and the rest.
    const side = (x: number) => (x >= 18 && x < 48 ? 0 : 1);
    const start = new Map(sim.creatures.map((c) => [c.id, side(c.x)]));
    for (let t = 0; t < 400; t++) sim.step();
    for (const c of sim.creatures) {
      if (start.has(c.id)) expect(side(c.x)).toBe(start.get(c.id));
    }
    expect(home.size).toBe(60);
  });
});

describe('signals', () => {
  it('follow the brain’s call output and cost energy in proportion to loudness', () => {
    const sim = lifeSim();
    const quiet = makeCreature(5, 5);
    const loud = makeCreature(15, 15);
    loud.genome[TRAIT_COUNT + BRAIN_LAYOUT.B2 + OUT_SIGNAL] = 5;
    sim.creatures.push(quiet, loud);
    sim.step();
    expect(quiet.signal).toBe(0);
    expect(loud.signal).toBeGreaterThan(0.99);
    const { config } = sim;
    const base = upkeep(quiet, config);
    expect(upkeep(loud, config) - base).toBeCloseTo(config.creatures.signalCost * loud.signal, 9);
    const negative = makeCreature(25, 25);
    negative.genome[TRAIT_COUNT + BRAIN_LAYOUT.B2 + OUT_SIGNAL] = -5;
    sim.creatures.push(negative);
    sim.step();
    expect(negative.signal).toBeLessThan(-0.99);
    expect(upkeep(negative, config) - base).toBeCloseTo(
      config.creatures.signalCost * -negative.signal,
      9,
    );
  });

  it('are seen by neighbours, as they were last tick, whatever order creatures are stored in', () => {
    const run = (reverse: boolean) => {
      const sim = lifeSim();
      const watcher = makeCreature(10, 10, 0);
      const caller = makeCreature(13, 10, Math.PI);
      caller.genome[TRAIT_COUNT + BRAIN_LAYOUT.B2 + OUT_SIGNAL] = 5;
      sim.creatures.push(...(reverse ? [caller, watcher] : [watcher, caller]));
      sim.step();
      const middle = Math.floor(RAY_COUNT / 2) * RAY_CHANNELS + 5;
      const first = watcher.inputs[middle];
      sim.step();
      return [first, watcher.inputs[middle]];
    };
    const forward = run(false);
    expect(forward[0]).toBe(0); // the call hadn't been made yet
    expect(forward[1]).toBeGreaterThan(0.99);
    expect(run(true)).toEqual(forward);
  });
});

describe('crossover', () => {
  it('takes every gene from one parent or the other, about half each', () => {
    const a = new Float32Array(400).fill(1);
    const b = new Float32Array(400).fill(2);
    const child = crossover(a, b, new Rng(1));
    expect(child.every((g) => g === 1 || g === 2)).toBe(true);
    const fromA = child.filter((g) => g === 1).length;
    expect(fromA).toBeGreaterThan(150);
    expect(fromA).toBeLessThan(250);
    expect(crossover(a, b, new Rng(1))).toEqual(child);
    expect(crossover(a, a, new Rng(2))).toEqual(a);
  });
});

describe('sexual reproduction', () => {
  const eager = (x: number, y: number, genes = {}, energy = 90) => {
    const c = makeCreature(x, y, 0, { reproThreshold: 0, ...genes }, energy);
    c.genome[TRAIT_COUNT + BRAIN_LAYOUT.B2 + OUT_REPRODUCE] = 5;
    return c;
  };
  const sexual = (extra = {}) =>
    lifeSim({
      creatures: { sexual: true, basalCost: 0, moveCost: 0, senseCost: 0, ...extra },
      mutation: { rateMultiplier: 0 },
    });

  it('needs two willing creatures close together, and each pays half', () => {
    const sim = sexual();
    const a = eager(10, 10);
    const b = eager(10.8, 10);
    sim.creatures.push(a, b);
    sim.step();
    const { birthCost, birthEfficiency } = sim.config.creatures;
    expect(sim.creatures).toHaveLength(3);
    expect(a.energy).toBeCloseTo(90 - birthCost / 2, 6);
    expect(b.energy).toBeCloseTo(90 - birthCost / 2, 6);
    expect(sim.creatures[2].energy).toBeCloseTo(birthCost * birthEfficiency, 6);
    expect(sim.stats.births).toBe(1);
  });

  it('gives the child a mix of both parents’ genes', () => {
    const sim = sexual();
    const a = eager(10, 10);
    const b = eager(10.8, 10);
    for (let i = TRAIT_COUNT; i < a.genome.length - 3; i++) {
      if (i !== TRAIT_COUNT + BRAIN_LAYOUT.B2 + OUT_REPRODUCE) {
        a.genome[i] = 0.1;
        b.genome[i] = 0.3;
      }
    }
    sim.creatures.push(a, b);
    sim.step();
    const child = sim.creatures[2];
    const body = Array.from(child.genome.subarray(TRAIT_COUNT, TRAIT_COUNT + 100));
    expect(body.every((g) => g === Float32Array.of(0.1)[0] || g === Float32Array.of(0.3)[0])).toBe(
      true,
    );
    expect(body.some((g) => g === Float32Array.of(0.1)[0])).toBe(true);
    expect(body.some((g) => g === Float32Array.of(0.3)[0])).toBe(true);
    expect(child.parentId).toBe(a.id);
  });

  it('does nothing when the creatures are too far apart, alone, unwilling or too different', () => {
    const farApart = sexual();
    farApart.creatures.push(eager(5, 5), eager(20, 20));
    farApart.step();
    expect(farApart.stats.births).toBe(0);

    const alone = sexual();
    alone.creatures.push(eager(5, 5));
    alone.step();
    expect(alone.stats.births).toBe(0);

    const unwilling = sexual();
    unwilling.creatures.push(eager(10, 10), makeCreature(10.5, 10, 0, { reproThreshold: 0 }, 90));
    unwilling.step();
    expect(unwilling.stats.births).toBe(0);

    const different = sexual({ mateCompatibility: 0.05 });
    const a = eager(10, 10);
    const b = eager(10.5, 10);
    for (let i = TRAIT_COUNT; i < b.genome.length - 3; i++) b.genome[i] += 0.5;
    different.creatures.push(a, b);
    different.step();
    expect(different.stats.births).toBe(0);
  });

  it('lets each creature mate once a tick, pairing the nearest', () => {
    const sim = sexual();
    const a = eager(10, 10);
    const b = eager(10.5, 10);
    const c = eager(11, 10);
    sim.creatures.push(a, b, c);
    sim.step();
    expect(sim.stats.births).toBe(1);
    expect(c.energy).toBe(90); // left out
  });

  it('respects the population cap', () => {
    const sim = sexual({ maxPopulation: 4 });
    for (let i = 0; i < 4; i++) sim.creatures.push(eager(3 + i * 0.3, 3));
    sim.step();
    expect(sim.creatures.length).toBeLessThanOrEqual(4);
  });

  it('leaves asexual reproduction as it was when switched off', () => {
    const sim = lifeSim({ creatures: { sexual: false } });
    sim.creatures.push(eager(10, 10));
    sim.step();
    expect(sim.stats.births).toBe(1);
  });

  it('never creates energy, and a sexual world runs without trouble', () => {
    const sim = new Simulation({
      seed: 8,
      creatures: { sexual: true, initialCount: 120, startEnergy: 90, mateRange: 3 },
      food: { initialFill: 0, regrowRate: 0 },
    });
    let total = sim.creatures.reduce((s, c) => s + c.energy, 0);
    for (let t = 0; t < 200; t++) {
      sim.step();
      const now = sim.creatures.reduce((s, c) => s + c.energy, 0);
      expect(now).toBeLessThanOrEqual(total + 1e-6);
      total = now;
    }
    expect(sim.stats.births).toBeGreaterThan(0);
  });
});

describe('disasters', () => {
  const crowded = (n: number, extra = {}) => {
    const sim = lifeSim({
      creatures: { maxAge: 0, basalCost: 0, moveCost: 0, senseCost: 0 },
      ...extra,
    });
    for (let i = 0; i < n; i++) sim.creatures.push(makeCreature(i % 32, Math.floor(i / 32) % 32));
    sim.creatures.forEach((c) => sim.species.addFounder(c, 0));
    return sim;
  };

  it('a drought slows regrowth for a while, then ends with an announcement', () => {
    const sim = lifeSim({
      food: { initialFill: 0, regrowRate: 0.1, maxPerTile: 100 },
      terrain: { fertilityContrast: 0 },
    });
    sim.step();
    const normal = sim.world.food[0];
    sim.world.food.fill(0);
    sim.trigger('drought');
    expect(sim.modifiers).toHaveLength(1);
    sim.step();
    expect(sim.world.food[0]).toBeCloseTo(normal * 0.1, 9);
    expect(sim.events.events.at(-1)).toMatchObject({
      kind: 'disaster',
      major: true,
      text: 'A DROUGHT BEGINS',
    });
    sim.tick = sim.modifiers[0].endTick;
    sim.step();
    expect(sim.modifiers).toHaveLength(0);
    expect(sim.events.events.at(-1)?.text).toBe('THE DROUGHT ENDS');
  });

  it('an ice age makes living costlier as well as slowing regrowth', () => {
    const sim = crowded(2);
    const c = sim.creatures[0];
    c.energy = 50;
    const before = c.energy;
    sim.config.creatures.basalCost = 0.1;
    sim.step();
    const normalCost = before - c.energy;
    c.energy = 50;
    sim.trigger('iceAge');
    sim.step();
    expect(before - c.energy).toBeGreaterThan(normalCost * 1.3);
  });

  it('a bloom fills every plant tile to the cap', () => {
    const sim = lifeSim({ terrain: { waterFraction: 0.1 } });
    sim.trigger('bloom');
    for (let i = 0; i < sim.world.food.length; i++) {
      expect(sim.world.food[i]).toBe(sim.world.fertility[i] > 0 ? sim.config.food.maxPerTile : 0);
    }
  });

  it('a plague kills roughly two in five, and everything stays consistent', () => {
    const sim = crowded(1000, {
      creatures: { maxPopulation: 5000, maxAge: 0, basalCost: 0, moveCost: 0, senseCost: 0 },
    });
    const deaths: string[] = [];
    sim.onDeath = (_, cause) => deaths.push(cause);
    sim.trigger('plague');
    expect(sim.creatures.length).toBeGreaterThan(500);
    expect(sim.creatures.length).toBeLessThan(700);
    expect(sim.stats.disaster).toBe(1000 - sim.creatures.length);
    expect(deaths.every((c) => c === 'disaster')).toBe(true);
    expect(sim.species.list().reduce((n, s) => n + s.count, 0)).toBe(sim.creatures.length);
    expect(sim.events.events.at(-1)?.text).toBe(`A PLAGUE KILLS ${1000 - sim.creatures.length}`);
  });

  it('a meteor kills everything near one spot and scorches the plants, and only there', () => {
    const sim = lifeSim({ terrain: { waterFraction: 0 }, food: { initialFill: 1 } });
    for (let i = 0; i < 400; i++) sim.creatures.push(makeCreature((i * 7) % 32, (i * 13) % 32));
    sim.creatures.forEach((c) => sim.species.addFounder(c, 0));
    const victims: [number, number][] = [];
    sim.onDeath = (c) => victims.push([c.x, c.y]);
    sim.trigger('meteor');
    const dead = 400 - sim.creatures.length;
    expect(dead).toBeGreaterThan(0);
    expect(dead).toBeLessThan(400);
    expect(victims).toHaveLength(dead);
    const scorched = sim.world.food.filter((f) => f === 0).length;
    expect(scorched).toBeGreaterThan(80);
    expect(scorched).toBeLessThan(160);
    // The victims all lie inside one circle of radius 6, so no two are more than 12 apart.
    for (const a of victims) {
      for (const b of victims)
        expect(Math.sqrt(sim.world.distanceSq(a[0], a[1], b[0], b[1]))).toBeLessThanOrEqual(12.001);
    }
    // Nobody who survived is inside the scorched area: every survivor stands on food.
    for (const c of sim.creatures) expect(sim.world.foodAt(c.x, c.y)).toBeGreaterThan(0);
    expect(sim.events.events.at(-1)?.text).toBe(`A METEOR STRIKES: ${dead} DIE`);
  });

  it('introducing hunters or grazers adds new creatures as a new species of the right diet', () => {
    const sim = crowded(10);
    sim.trigger('hunters');
    expect(sim.creatures).toHaveLength(25);
    const hunters = sim.creatures.slice(10);
    expect(hunters.every((c) => c.traits.diet >= 0.85)).toBe(true);
    expect(new Set(hunters.map((c) => c.speciesId)).size).toBe(1);
    expect(hunters[0].speciesId).not.toBe(sim.creatures[0].speciesId);
    expect(sim.species.get(hunters[0].speciesId)).toMatchObject({ parentId: null, count: 15 });
    sim.trigger('grazers');
    expect(sim.creatures).toHaveLength(55);
    expect(sim.creatures.slice(25).every((c) => c.traits.diet <= 0.1)).toBe(true);
    expect(sim.events.events.at(-1)?.text).toBe('30 GRAZERS ARE INTRODUCED');
  });

  it('setDiet keeps the diet gene inside 0 to 1', () => {
    const g = new Float32Array(TRAIT_COUNT + 5);
    setDiet(g, 7);
    expect(Math.max(...g)).toBe(1);
    setDiet(g, -2);
    expect(Math.min(...g)).toBe(0);
  });

  it('can be triggered through the host, and show as hazards while active', () => {
    const host = new SimHost(resolveConfig({ seed: 2 }));
    host.trigger('drought');
    host.refresh(false);
    expect(host.scene.hazards).toEqual(['DROUGHT']);
    host.trigger('iceAge');
    host.refresh(false);
    expect(host.scene.hazards).toEqual(['DROUGHT', 'ICE AGE']);
  });
});

describe('seasonal cold', () => {
  it('raises upkeep in the depth of winter and not in summer, and only when asked', () => {
    const make = (coldCost: number) =>
      lifeSim({ food: { seasons: { enabled: true, lengthTicks: 400, amplitude: 0.5, coldCost } } });
    const factor = (sim: Simulation, tick: number) => {
      sim.tick = tick;
      return sim['upkeepFactor']();
    };
    const cold = make(1);
    expect(factor(cold, 100)).toBe(1); // summer peak
    expect(factor(cold, 300)).toBeCloseTo(2, 9); // winter trough
    expect(factor(cold, 200)).toBeCloseTo(1, 9);
    const none = make(0);
    expect(factor(none, 300)).toBe(1);
    expect(factor(lifeSim(), 300)).toBe(1);
  });
});
