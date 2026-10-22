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
    let bad = 0;
    for (let i = 0; i < 400; i++) {
      sim.step();
      for (const c of sim.creatures) {
        const inBounds = c.x >= 0 && c.x < sim.world.width && c.y >= 0 && c.y < sim.world.height;
        if (!inBounds || !sim.world.isWalkable(c.x, c.y) || !Number.isFinite(c.speed)) bad++;
        if (!(c.energy > 0 && c.energy <= sim.config.creatures.maxEnergy)) bad++;
      }
    }
    expect(bad).toBe(0);
    expect(sim.tick).toBe(400);
    expect(sim.stats.births).toBeGreaterThan(0);
  });

  it('actually moves creatures and updates their memory', () => {
    const sim = new Simulation({ seed: 5, creatures: { initialCount: 20 } });
    const before = snapshot(sim);
    for (let i = 0; i < 50; i++) sim.step();
    const after = snapshot(sim);
    expect(after).not.toEqual(before);
    expect(sim.creatures.some((c) => c.memory.some((m) => m !== 0))).toBe(true);
  });

  it('runs with no creatures', () => {
    const sim = new Simulation({ creatures: { initialCount: 0 } });
    expect(() => sim.step()).not.toThrow();
  });

  it('reports births and deaths through its hooks', () => {
    const sim = new Simulation({ seed: 3, creatures: { initialCount: 60, maxAge: 300 } });
    const born: number[] = [];
    const died: string[] = [];
    sim.onBirth = (c) => born.push(c.id);
    sim.onDeath = (_, cause) => died.push(cause);
    for (let i = 0; i < 400; i++) sim.step();
    expect(born.length).toBe(sim.stats.births);
    expect(died.filter((c) => c === 'starved').length).toBe(sim.stats.starved);
    expect(died.filter((c) => c === 'age').length).toBe(sim.stats.diedOfAge);
    expect(born.length).toBeGreaterThan(0);
    expect(died.length).toBeGreaterThan(0);
    expect(new Set(born).size).toBe(born.length);
  });
});
