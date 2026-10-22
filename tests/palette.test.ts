import { describe, expect, it } from 'vitest';
import {
  COLORS,
  HUE_COLUMN_COUNT,
  NES_COLOR_COUNT,
  creatureColors,
  css,
  hueColumn,
  nes,
} from '../src/render/palette';

describe('palette', () => {
  it('has the 64 NES colours, each a valid RGB triple', () => {
    expect(NES_COLOR_COUNT).toBe(64);
    for (let i = 0; i < NES_COLOR_COUNT; i++) {
      for (const channel of nes(i)) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });

  it('matches known NES colours', () => {
    expect(nes(0x0f)).toEqual([0, 0, 0]);
    expect(nes(0x30)).toEqual([252, 252, 252]);
    expect(nes(0x16)).toEqual([248, 56, 0]);
  });

  it('rejects indices outside the palette', () => {
    expect(() => nes(64)).toThrow(/out of range/);
    expect(() => nes(-1)).toThrow(/out of range/);
  });

  it('formats colours for CSS', () => {
    expect(css([1, 2, 3])).toBe('rgb(1, 2, 3)');
  });

  it('only uses colours from the NES palette for its named colours', () => {
    const all = new Set(Array.from({ length: NES_COLOR_COUNT }, (_, i) => nes(i).join(',')));
    for (const color of Object.values(COLORS)) expect(all.has(color.join(','))).toBe(true);
  });

  it('maps hues to the 12 coloured palette columns, clamped at both ends', () => {
    expect(hueColumn(0)).toBe(1);
    expect(hueColumn(0.999)).toBe(HUE_COLUMN_COUNT);
    expect(hueColumn(1)).toBe(HUE_COLUMN_COUNT);
    expect(hueColumn(-0.5)).toBe(1);
    expect(hueColumn(7)).toBe(HUE_COLUMN_COUNT);
    const columns = new Set(Array.from({ length: 120 }, (_, i) => hueColumn(i / 120)));
    expect(columns.size).toBe(HUE_COLUMN_COUNT);
  });

  it('gives creatures a light body and a darker shade of the same hue', () => {
    for (let i = 0; i < 12; i++) {
      const { body, shade } = creatureColors((i + 0.5) / 12);
      expect(body).toEqual(nes(0x20 + i + 1));
      expect(shade).toEqual(nes(0x10 + i + 1));
    }
  });
});
