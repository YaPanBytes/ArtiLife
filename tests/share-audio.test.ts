import { describe, expect, it } from 'vitest';
import { PRESETS, findPreset } from '../src/presets';
import { screenshotName } from '../src/screenshot';
import { Chiptune, type AudioContextLike } from '../src/audio';
import { configDiff, decodeShare, encodeShare, shareUrl } from '../src/share';
import { DEFAULT_CONFIG, resolveConfig } from '../src/sim/config';
import { Simulation } from '../src/sim/simulation';

describe('share codes', () => {
  it('are empty-ish for the default rules and carry only what changed', () => {
    expect(configDiff(DEFAULT_CONFIG)).toEqual({});
    const config = resolveConfig({
      seed: 77,
      food: { regrowRate: 0.05, seasons: { enabled: true } },
    });
    expect(configDiff(config)).toEqual({
      seed: 77,
      food: { regrowRate: 0.05, seasons: { enabled: true } },
    });
  });

  it('round-trip any settings exactly', () => {
    for (const overrides of [
      {},
      { seed: 1234567 },
      { terrain: { barrier: 'wall', barrierGaps: 0 }, creatures: { sexual: true } },
      { predation: { biteDamage: 0.5 }, mutation: { rateMultiplier: 0 } },
    ]) {
      const config = resolveConfig(overrides);
      expect(decodeShare(encodeShare(config))).toEqual(config);
    }
  });

  it('use only characters that are safe in a link, and stay short', () => {
    const code = encodeShare(resolveConfig({ seed: 99, food: { regrowRate: 0.031 } }));
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(100);
  });

  it('reject codes that are not valid', () => {
    expect(() => decodeShare('!!!')).toThrow(/not valid/);
    expect(() => decodeShare('bm90IGpzb24')).toThrow(/not valid/); // "not json"
    expect(() => decodeShare(encodeShare(resolveConfig({ seed: 5 })).slice(0, 6))).toThrow(
      /not valid/,
    );
    const unknown = btoa('{"nope":1}').replace(/=+$/, '');
    expect(() => decodeShare(unknown)).toThrow(/unknown option/);
    const invalid = btoa('{"world":{"width":-4}}').replace(/=+$/, '');
    expect(() => decodeShare(invalid)).toThrow(/world.width/);
  });

  it('make a link that starts the same world', () => {
    const config = resolveConfig({ seed: 5, creatures: { initialCount: 30 } });
    const link = shareUrl(config, 'https://example.com/artilife/?old=1#x');
    const url = new URL(link);
    expect(url.origin + url.pathname).toBe('https://example.com/artilife/');
    expect(url.searchParams.has('old')).toBe(false);
    expect(url.hash).toBe('');
    const a = new Simulation(config);
    const b = new Simulation(decodeShare(url.searchParams.get('s')!));
    for (let t = 0; t < 100; t++) {
      a.step();
      b.step();
    }
    expect(b.creatures.map((c) => c.x)).toEqual(a.creatures.map((c) => c.x));
  });
});

describe('presets', () => {
  it('have unique names and valid settings', () => {
    expect(new Set(PRESETS.map((p) => p.name)).size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      expect(() => resolveConfig(p.config)).not.toThrow();
      expect(p.blurb.length).toBeGreaterThan(20);
    }
    expect(findPreset('GARDEN')?.name).toBe('GARDEN');
    expect(findPreset('NOPE')).toBeUndefined();
    expect(PRESETS[0].name).toBe('DEFAULT');
    expect(PRESETS[0].config).toEqual({});
  });

  it('change the rules they say they change', () => {
    const c = (name: string) => resolveConfig(findPreset(name)!.config);
    expect(c('LUSH EDEN').food.regrowRate).toBeGreaterThan(DEFAULT_CONFIG.food.regrowRate);
    expect(c('DUST BOWL').food.regrowRate).toBeLessThan(DEFAULT_CONFIG.food.regrowRate);
    expect(c('ICE AGE').food.seasons.enabled).toBe(true);
    expect(c('ISLAND CHAIN').terrain.barrier).toBe('river');
    expect(c('GARDEN').predation.biteDamage).toBe(0);
    expect(c('MATING SEASON').creatures.sexual).toBe(true);
    expect(c('EVOLVING BRAINS').brain.type).toBe('neat');
    expect(c('MEMORY MINDS').brain.type).toBe('recurrent');
    expect(c('QUICK LEARNERS').learning.rate).toBeGreaterThan(0);
    expect(c('ARCHIPELAGO').islands.count).toBe(3);
  });

  it('each run for a while without breaking', () => {
    for (const p of PRESETS) {
      const sim = new Simulation({ ...p.config, seed: 3 });
      for (let t = 0; t < 150; t++) sim.step();
      for (const creature of sim.creatures) {
        expect(Number.isFinite(creature.energy) && Number.isFinite(creature.x)).toBe(true);
      }
    }
  });
});

/** A stand-in for the browser's audio that records what was asked of it. */
function fakeAudio() {
  const made: { type: string; start: number }[] = [];
  const context: AudioContextLike = {
    currentTime: 1,
    destination: {},
    createOscillator: () => {
      const note = { type: '', start: -1 };
      made.push(note);
      return {
        set type(v: string) {
          note.type = v;
        },
        get type() {
          return note.type;
        },
        frequency: { setValueAtTime() {}, linearRampToValueAtTime() {} },
        connect: () => ({}),
        start: (t: number) => (note.start = t),
        stop() {},
      };
    },
    createGain: () => ({
      gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
      connect: () => ({}),
    }),
  };
  return { context, made };
}

describe('Chiptune', () => {
  it('is silent until switched on, and makes no audio context until then', () => {
    let contexts = 0;
    const { context } = fakeAudio();
    const sound = new Chiptune(
      () => (contexts++, context),
      () => 0,
    );
    expect(sound.enabled).toBe(false);
    expect(sound.play('birth')).toBe(false);
    expect(contexts).toBe(0);
    sound.enabled = true;
    expect(contexts).toBe(1);
    expect(sound.play('birth')).toBe(true);
    sound.enabled = false;
    expect(sound.play('death')).toBe(false);
  });

  it('plays one oscillator per note, each starting after the clock’s current time', () => {
    const { context, made } = fakeAudio();
    const sound = new Chiptune(
      () => context,
      () => 0,
    );
    sound.enabled = true;
    sound.play('event');
    expect(made).toHaveLength(3);
    expect(made.every((m) => m.type === 'square')).toBe(true);
    expect(made.map((m) => m.start)).toEqual([...made.map((m) => m.start)].sort((a, b) => a - b));
    expect(made[0].start).toBeGreaterThanOrEqual(1);
  });

  it('limits how often each sound can repeat, but not different sounds', () => {
    const { context } = fakeAudio();
    let t = 0;
    const sound = new Chiptune(
      () => context,
      () => t,
    );
    sound.enabled = true;
    expect(sound.play('birth')).toBe(true);
    t = 10;
    expect(sound.play('birth')).toBe(false);
    expect(sound.play('death')).toBe(true);
    t = 200;
    expect(sound.play('birth')).toBe(true);
  });

  it('copes with a browser that has no audio', () => {
    const sound = new Chiptune(
      () => null,
      () => 0,
    );
    sound.enabled = true;
    expect(sound.play('birth')).toBe(false);
  });
});

describe('screenshotName', () => {
  it('says which world and moment it shows', () => {
    expect(screenshotName(7, 1234)).toBe('artilife-seed7-tick1234.png');
  });
});
