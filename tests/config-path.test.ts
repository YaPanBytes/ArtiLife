import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/sim/config';
import { getPath, setPath } from '../src/sim/config-path';

describe('config paths', () => {
  it('reads nested values', () => {
    const c = resolveConfig();
    expect(getPath(c, 'food.regrowRate')).toBe(c.food.regrowRate);
    expect(getPath(c, 'food.seasons.enabled')).toBe(false);
    expect(getPath(c, 'seed')).toBe(c.seed);
  });

  it('writes nested and top-level values', () => {
    const c = resolveConfig();
    setPath(c, 'food.seasons.lengthTicks', 1234);
    setPath(c, 'seed', 77);
    expect(c.food.seasons.lengthTicks).toBe(1234);
    expect(c.seed).toBe(77);
  });

  it('rejects unknown paths and values of the wrong type', () => {
    const c = resolveConfig();
    expect(() => getPath(c, 'food.nope')).toThrow(/unknown config path/);
    expect(() => getPath(c, 'nope.x')).toThrow(/unknown config path/);
    expect(() => setPath(c, 'food.nope', 1)).toThrow(/unknown config path/);
    expect(() => setPath(c, 'food.regrowRate', 'fast')).toThrow(/number/);
    expect(() => setPath(c, 'food', 3)).toThrow(/object/);
  });
});

describe('config paths and prototypes', () => {
  it('only knows the config’s own settings, not what every object inherits', () => {
    const config = resolveConfig();
    expect(() => getPath(config, 'food.toString')).toThrow(/unknown config path/);
    expect(() => getPath(config, '__proto__')).toThrow(/unknown config path/);
    expect(() => setPath(config, 'food.constructor', 1)).toThrow(/unknown config path/);
    expect(() => resolveConfig({ food: { hasOwnProperty: 1 } } as never)).toThrow(/unknown option/);
  });
});
