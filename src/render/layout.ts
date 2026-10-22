/** NES screen: 256x224. The top 56 pixels are the HUD, the rest is the playfield. */
export const SCREEN_W = 256;
export const SCREEN_H = 224;
export const HUD_H = 56;
export const FIELD_W = SCREEN_W;
export const FIELD_H = SCREEN_H - HUD_H;
/** One world tile is 8x8 pixels. */
export const TILE = 8;
export const MINIMAP_SIZE = 48;
