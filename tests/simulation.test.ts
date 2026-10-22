import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';

const snapshot = (sim: Simulation) =>
  sim.creatures.map((c) => [c.x, c.y, c.heading, c.speed, ...c.memory]);

describe('Simulation', () => {
  it('spawns the configured number of creatures on walkable tiles', () => {
    const sim = new Simulation({ creatures: { initialCount: 40 } });
    expect(sim.creatures.length).toBe(40);
    for (const c of sim.creatures) expect(sim.world.isWalkable(c.x, c.y)).toBe(true);
    expect(new Set(sim.creatures.map((c) => c.id)).size).toBe(40);
  });

  it('is deterministic for a given seed and differs between seeds', () => {
    const run = (seed: number) => {
      const sim = new Simulation({ seed, creatures: { initialCount: 30 } });
      for (let i = 0; i < 200; i++) sim.step();
      return snapshot(sim);
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });

  it('keeps creatures in bounds and on walkable ground over a long run', () => {
    const sim = new Simulation({ seed: 3, creatures: { initialCount: 80 } });
    for (let i = 0; i < 500; i++) {
      sim.step();
      for (const c of sim.creatures) {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.x).toBeLessThan(sim.world.width);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeLessThan(sim.world.height);
        expect(sim.world.isWalkable(c.x, c.y)).toBe(true);
        expect(Number.isFinite(c.speed)).toBe(true);
      }
    }
    expect(sim.tick).toBe(500);
    expect(sim.creatures.every((c) => c.age === 500)).toBe(true);
  });

  it('actually moves creatures and updates their memory', () => {
    const sim = new Simulation({ seed: 5, creatures: { initialCount: 20 } });
    const before = snapshot(sim);
    for (let i = 0; i < 50; i++) sim.step();
    const after = snapshot(sim);
    expect(after).not.toEqual(before);
    expect(sim.creatures.some((c) => c.memory.some((m) => m !== 0))).toBe(true);
  });

  it('is independent of creature update order', () => {
    const forward = new Simulation({ seed: 9, creatures: { initialCount: 30 } });
    const reversed = new Simulation({ seed: 9, creatures: { initialCount: 30 } });
    reversed.creatures.reverse();
    for (let i = 0; i < 100; i++) {
      forward.step();
      reversed.step();
    }
    const byId = (s: Simulation) =>
      new Map(s.creatures.map((c) => [c.id, [c.x, c.y, c.heading] as number[]]));
    expect(byId(reversed)).toEqual(byId(forward));
  });

  it('runs with no creatures', () => {
    const sim = new Simulation({ creatures: { initialCount: 0 } });
    expect(() => sim.step()).not.toThrow();
  });
});
