import type { RGB } from './palette';

/** A small RGBA image, kept as plain data so it can be built and tested without a DOM. */
export interface PixelImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * Build an image from rows of characters. '.' is transparent; every other
 * character must be in the legend, which maps it to a colour.
 */
export function renderPattern(rows: readonly string[], legend: Record<string, RGB>): PixelImage {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) => {
    if (row.length !== width) {
      throw new RangeError(`pattern row ${y} has ${row.length} columns, expected ${width}`);
    }
    for (let x = 0; x < width; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      const color = legend[ch];
      if (!color) throw new RangeError(`pattern uses '${ch}' which is not in the legend`);
      const o = (y * width + x) * 4;
      data[o] = color[0];
      data[o + 1] = color[1];
      data[o + 2] = color[2];
      data[o + 3] = 255;
    }
  });
  return { width, height, data };
}

export function flipHorizontal(img: PixelImage): PixelImage {
  const data = new Uint8ClampedArray(img.data.length);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const from = (y * img.width + x) * 4;
      const to = (y * img.width + (img.width - 1 - x)) * 4;
      data.set(img.data.subarray(from, from + 4), to);
    }
  }
  return { width: img.width, height: img.height, data };
}

/** Enlarge by a whole-number factor, one source pixel becoming a k x k block. */
export function scaleUp(img: PixelImage, k: number): PixelImage {
  const width = img.width * k;
  const height = img.height * k;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (Math.floor(y / k) * img.width + Math.floor(x / k)) * 4;
      data.set(img.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** Number of non-transparent pixels. */
export function opaqueCount(img: PixelImage): number {
  let n = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 0) n++;
  return n;
}
