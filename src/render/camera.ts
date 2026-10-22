import { FIELD_H, FIELD_W, TILE } from './layout';

/** Shortest signed distance from `a` to `b` on a ring of the given size. */
export function wrapDelta(a: number, b: number, size: number): number {
  const d = (((b - a) % size) + size) % size;
  return d > size / 2 ? d - size : d;
}

const wrap = (v: number, size: number) => ((v % size) + size) % size;

/**
 * The view onto the world. Position is the top-left of the playfield in world
 * pixels; the world wraps, so the camera does too.
 */
export class Camera {
  x = 0;
  y = 0;
  readonly worldW: number;
  readonly worldH: number;

  constructor(
    worldTilesW: number,
    worldTilesH: number,
    readonly viewW = FIELD_W,
    readonly viewH = FIELD_H,
  ) {
    this.worldW = worldTilesW * TILE;
    this.worldH = worldTilesH * TILE;
  }

  get centerX(): number {
    return this.x + this.viewW / 2;
  }

  get centerY(): number {
    return this.y + this.viewH / 2;
  }

  centerOn(wx: number, wy: number): void {
    this.x = wrap(wx - this.viewW / 2, this.worldW);
    this.y = wrap(wy - this.viewH / 2, this.worldH);
  }

  /** Ease towards a world pixel position along the shortest way round. */
  follow(wx: number, wy: number, ease = 0.25): void {
    const dx = wrapDelta(this.centerX, wx, this.worldW);
    const dy = wrapDelta(this.centerY, wy, this.worldH);
    this.x = wrap(this.x + dx * ease, this.worldW);
    this.y = wrap(this.y + dy * ease, this.worldH);
  }

  pan(dx: number, dy: number): void {
    this.x = wrap(this.x + dx, this.worldW);
    this.y = wrap(this.y + dy, this.worldH);
  }

  /** Playfield pixel of a world pixel, using whichever copy of the world is nearest the view. */
  toScreen(wx: number, wy: number): [number, number] {
    return [
      this.viewW / 2 + wrapDelta(this.centerX, wx, this.worldW),
      this.viewH / 2 + wrapDelta(this.centerY, wy, this.worldH),
    ];
  }

  /** World pixel under a playfield pixel. */
  toWorld(sx: number, sy: number): [number, number] {
    return [
      wrap(this.centerX + (sx - this.viewW / 2), this.worldW),
      wrap(this.centerY + (sy - this.viewH / 2), this.worldH),
    ];
  }
}
