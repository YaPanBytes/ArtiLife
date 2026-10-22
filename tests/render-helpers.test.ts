import { describe, expect, it } from 'vitest';
import {
  FOOD_HEAT,
  HUE_COLUMN_COUNT,
  RAMPS,
  rampColumn,
  speciesColumn,
} from '../src/render/palette';
import { glyphFor } from '../src/render/renderer';
import { OVERLAYS } from '../src/render/view';

describe('colour ramps', () => {
  it('map 0 to the first column and 1 to the last, in steps', () => {
    for (const ramp of Object.values(RAMPS)) {
      expect(rampColumn(ramp, 0)).toBe(ramp[0]);
      expect(rampColumn(ramp, 1)).toBe(ramp[ramp.length - 1]);
      expect(rampColumn(ramp, -3)).toBe(ramp[0]);
      expect(rampColumn(ramp, 9)).toBe(ramp[ramp.length - 1]);
      expect(rampColumn(ramp, 0.5)).toBe(ramp[Math.floor(ramp.length / 2)]);
      for (const col of ramp) {
        expect(col).toBeGreaterThanOrEqual(1);
        expect(col).toBeLessThanOrEqual(HUE_COLUMN_COUNT);
      }
    }
  });

  it('give hungry creatures red and well-fed ones green', () => {
    expect(rampColumn(RAMPS.energy, 0.01)).toBe(6);
    expect(rampColumn(RAMPS.energy, 0.99)).toBe(10);
  });

  it('colour species with valid columns, differently for neighbouring ids', () => {
    for (let id = 0; id < 100; id++) {
      const col = speciesColumn(id);
      expect(col).toBeGreaterThanOrEqual(1);
      expect(col).toBeLessThanOrEqual(HUE_COLUMN_COUNT);
    }
    expect(new Set([1, 2, 3, 4, 5].map(speciesColumn)).size).toBe(5);
  });

  it('has five ground colours for the food overlay', () => {
    expect(FOOD_HEAT).toHaveLength(5);
    expect(OVERLAYS[0]).toBe('none');
    expect(new Set(OVERLAYS).size).toBe(OVERLAYS.length);
  });
});

describe('glyphFor', () => {
  it('uses a letter for what the creature eats, upper case when large', () => {
    expect(glyphFor(0, false)).toBe('h');
    expect(glyphFor(0.4, false)).toBe('o');
    expect(glyphFor(0.9, false)).toBe('w');
    expect(glyphFor(0.9, true)).toBe('W');
    expect(glyphFor(0, true)).toBe('H');
  });
});
