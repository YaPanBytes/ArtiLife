import { css, type RGB } from './palette';

/** Something pixels can be drawn onto: a canvas in the browser, a buffer in tests. */
export interface Surface {
  readonly width: number;
  readonly height: number;
  rect(x: number, y: number, w: number, h: number, color: RGB): void;
  text(str: string, x: number, y: number, color: RGB): void;
}

const FONT = '8px "Press Start 2P"';

export class CanvasSurface implements Surface {
  constructor(private readonly ctx: CanvasRenderingContext2D) {
    ctx.imageSmoothingEnabled = false;
  }

  get width(): number {
    return this.ctx.canvas.width;
  }

  get height(): number {
    return this.ctx.canvas.height;
  }

  rect(x: number, y: number, w: number, h: number, color: RGB): void {
    this.ctx.fillStyle = css(color);
    this.ctx.fillRect(x, y, w, h);
  }

  text(str: string, x: number, y: number, color: RGB): void {
    this.ctx.font = FONT;
    this.ctx.textBaseline = 'top';
    this.ctx.fillStyle = css(color);
    this.ctx.fillText(str, x, y);
  }
}

/** An in-memory surface that remembers what was drawn, for tests. */
export class BufferSurface implements Surface {
  private readonly pixels: (RGB | null)[];
  readonly texts: { str: string; x: number; y: number; color: RGB }[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = new Array(width * height).fill(null);
  }

  rect(x: number, y: number, w: number, h: number, color: RGB): void {
    for (let yy = Math.max(0, y); yy < Math.min(this.height, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(this.width, x + w); xx++) {
        this.pixels[yy * this.width + xx] = color;
      }
    }
  }

  text(str: string, x: number, y: number, color: RGB): void {
    this.texts.push({ str, x, y, color });
  }

  /** The colour at a pixel, or null if nothing was drawn there. */
  at(x: number, y: number): RGB | null {
    return this.pixels[y * this.width + x] ?? null;
  }

  /** How many pixels have exactly this colour. */
  count(color: RGB): number {
    return this.pixels.filter(
      (p) => p && p[0] === color[0] && p[1] === color[1] && p[2] === color[2],
    ).length;
  }
}

/** A one-pixel line (Bresenham), so plots stay crisp instead of being anti-aliased. */
export function line(s: Surface, x0: number, y0: number, x1: number, y1: number, color: RGB): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const ex = Math.round(x1);
  const ey = Math.round(y1);
  const dx = Math.abs(ex - x);
  const dy = -Math.abs(ey - y);
  const sx = x < ex ? 1 : -1;
  const sy = y < ey ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    s.rect(x, y, 1, 1, color);
    if (x === ex && y === ey) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}
