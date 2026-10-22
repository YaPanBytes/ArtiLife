import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, resolveConfig } from '../src/sim/config';

describe('resolveConfig', () => {
  it('returns the defaults when given nothing', () => {
    expect(resolveConfig()).toEqual(DEFAULT_CONFIG);
  });

  it('merges nested overrides without touching other fields', () => {
    const c = resolveConfig({ world: { width: 32 }, food: { seasons: { enabled: true } } });
    expect(c.world.width).toBe(32);
    expect(c.world.height).toBe(DEFAULT_CONFIG.world.height);
    expect(c.food.seasons.enabled).toBe(true);
    expect(c.food.seasons.lengthTicks).toBe(DEFAULT_CONFIG.food.seasons.lengthTicks);
  });

  it('does not mutate the defaults', () => {
    resolveConfig({ world: { width: 10 } });
    expect(DEFAULT_CONFIG.world.width).toBe(64);
  });

  it('rejects out-of-range values', () => {
    expect(() => resolveConfig({ world: { width: 0 } })).toThrow(/world.width/);
    expect(() => resolveConfig({ terrain: { waterFraction: 1.5 } })).toThrow(/waterFraction/);
    expect(() => resolveConfig({ terrain: { waterFraction: 0.7, rockFraction: 0.5 } })).toThrow(
      /must not exceed 1/,
    );
    expect(() => resolveConfig({ food: { maxPerTile: 0 } })).toThrow(/maxPerTile/);
  });

  it('rejects unknown options and wrong types', () => {
    expect(() => resolveConfig({ food: { bogus: 1 } } as never)).toThrow(/unknown option/);
    expect(() => resolveConfig({ seed: 'x' } as never)).toThrow(/expected number/);
  });

  it('validates the life-cycle options', () => {
    expect(() => resolveConfig({ creatures: { birthCost: 0 } })).toThrow(/birthCost/);
    expect(() => resolveConfig({ creatures: { birthEfficiency: 2 } })).toThrow(/birthEfficiency/);
    expect(() => resolveConfig({ creatures: { maxAge: -1 } })).toThrow(/maxAge/);
    expect(() => resolveConfig({ creatures: { maxPopulation: 1.5 } })).toThrow(/maxPopulation/);
    expect(() => resolveConfig({ creatures: { basalCost: -1 } })).toThrow(/basalCost/);
    expect(() => resolveConfig({ mutation: { rateMultiplier: -1 } })).toThrow(/rateMultiplier/);
    expect(resolveConfig({ mutation: { rateMultiplier: 0 } }).mutation.rateMultiplier).toBe(0);
  });
});
