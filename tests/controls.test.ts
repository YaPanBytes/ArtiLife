import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/sim/config';
import { Simulation } from '../src/sim/simulation';
import { CONTROLS, decimalsFor } from '../src/ui/controls';

describe('controls', () => {
  it('have unique labels and sensible ranges', () => {
    expect(new Set(CONTROLS.map((c) => c.label)).size).toBe(CONTROLS.length);
    for (const c of CONTROLS.filter((c) => c.kind === 'number')) {
      expect(c.min!).toBeLessThan(c.max!);
      expect(c.step!).toBeGreaterThan(0);
    }
  });

  it('start inside their slider range and read back what they set', () => {
    for (const c of CONTROLS) {
      const config = resolveConfig();
      const value = c.get(config);
      if (c.kind === 'toggle') {
        expect(typeof value).toBe('boolean');
        c.set(config, !value);
        expect(c.get(config)).toBe(!value);
      } else {
        expect(value as number).toBeGreaterThanOrEqual(c.min!);
        expect(value as number).toBeLessThanOrEqual(c.max!);
        c.set(config, c.max!);
        expect(c.get(config)).toBe(c.max);
      }
    }
  });

  it('only mark map-shaping controls as needing a new world', () => {
    for (const c of CONTROLS) expect(c.needsReset === true).toBe(c.group === 'NEW WORLD');
  });

  it('never let the player build an invalid config, at either end of every slider', () => {
    for (const end of ['min', 'max'] as const) {
      const config = resolveConfig();
      for (const c of CONTROLS) if (c.kind === 'number') c.set(config, c[end]!);
      expect(() => resolveConfig(config)).not.toThrow();
    }
  });

  it('keep the simulation healthy with every slider at its extremes', () => {
    for (const end of ['min', 'max'] as const) {
      const config = resolveConfig({ world: { width: 32, height: 32 } });
      for (const c of CONTROLS) if (c.kind === 'number') c.set(config, c[end]!);
      config.creatures.initialCount = Math.min(config.creatures.initialCount, 100);
      const sim = new Simulation(config);
      for (let i = 0; i < 60; i++) sim.step();
      for (const creature of sim.creatures) {
        expect(Number.isFinite(creature.energy)).toBe(true);
        expect(Number.isFinite(creature.x) && Number.isFinite(creature.y)).toBe(true);
      }
    }
  });

  it('work as live changes on a running simulation', () => {
    const sim = new Simulation({ creatures: { initialCount: 20 } });
    const eating = CONTROLS.find((c) => c.label === 'EATING')!;
    eating.set(sim.config, 3);
    expect(sim.config.creatures.eatRate).toBe(3);
    expect(() => sim.step()).not.toThrow();
  });

  it('format values with the right number of decimals', () => {
    expect(decimalsFor(1)).toBe(0);
    expect(decimalsFor(0.05)).toBe(2);
    expect(decimalsFor(0.0005)).toBe(4);
  });
});
