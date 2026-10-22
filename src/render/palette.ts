/** The NES master palette (NTSC). Index = row * 16 + column, as on the console. */
const NES_HEX: readonly number[] = [
  // $00
  0x7c7c7c, 0x0000fc, 0x0000bc, 0x4428bc, 0x940084, 0xa80020, 0xa81000, 0x881400, 0x503000,
  0x007800, 0x006800, 0x005800, 0x004058, 0x000000, 0x000000, 0x000000,
  // $10
  0xbcbcbc, 0x0078f8, 0x0058f8, 0x6844fc, 0xd800cc, 0xe40058, 0xf83800, 0xe45c10, 0xac7c00,
  0x00b800, 0x00a800, 0x00a844, 0x008888, 0x000000, 0x000000, 0x000000,
  // $20
  0xf8f8f8, 0x3cbcfc, 0x6888fc, 0x9878f8, 0xf878f8, 0xf85898, 0xf87858, 0xfca044, 0xf8b800,
  0xb8f818, 0x58d854, 0x58f898, 0x00e8d8, 0x787878, 0x000000, 0x000000,
  // $30
  0xfcfcfc, 0xa4e4fc, 0xb8b8f8, 0xd8b8f8, 0xf8b8f8, 0xf8a4c0, 0xf0d0b0, 0xfce0a8, 0xf8d878,
  0xd8f878, 0xb8f8b8, 0xb8f8d8, 0x00fcfc, 0xf8d8f8, 0x000000, 0x000000,
];

export type RGB = readonly [number, number, number];

/** Colour at an NES palette index, e.g. nes(0x16) is the red at $16. */
export function nes(index: number): RGB {
  const hex = NES_HEX[index];
  if (hex === undefined) throw new RangeError(`NES palette index out of range: ${index}`);
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

export const NES_COLOR_COUNT = NES_HEX.length;

export function css([r, g, b]: RGB): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/** Named colours used by the game, all taken from the NES palette. */
export const COLORS = {
  black: nes(0x0f),
  white: nes(0x30),
  grayLight: nes(0x10),
  grayDark: nes(0x00),
  blue: nes(0x12),
  blueDark: nes(0x02),
  red: nes(0x16),
  redDark: nes(0x06),
  ground: nes(0x36),
  groundSpeck: nes(0x27),
  rock: nes(0x17),
  rockDark: nes(0x07),
  rockLight: nes(0x27),
  water: nes(0x02),
  waterSpeck: nes(0x12),
  greenDark: nes(0x0a),
  green: nes(0x1a),
  greenLight: nes(0x2a),
} as const;

/** Hues 0-1 map to the 12 coloured columns of the palette ($x1 to $xC). */
export const HUE_COLUMN_COUNT = 12;

export function hueColumn(hue: number): number {
  const i = Math.floor(hue * HUE_COLUMN_COUNT);
  return 1 + Math.min(HUE_COLUMN_COUNT - 1, Math.max(0, i));
}

/** Body and shade colours for a creature of the given hue, snapped to the NES palette. */
export function creatureColors(hue: number): { body: RGB; shade: RGB } {
  const column = hueColumn(hue);
  return { body: nes(0x20 + column), shade: nes(0x10 + column) };
}
