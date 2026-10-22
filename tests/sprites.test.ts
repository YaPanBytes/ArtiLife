import { describe, expect, it } from 'vitest';
import { HUE_COLUMN_COUNT } from '../src/render/palette';
import { opaqueCount, type PixelImage } from '../src/render/pixel';
import {
  creatureImage,
  groundImage,
  heartImages,
  hitImages,
  plantImages,
  puffImages,
  rockImage,
  sparkleImages,
  waterImage,
} from '../src/render/sprites';

const is8x8 = (img: PixelImage) => img.width === 8 && img.height === 8;
const opaquePixelsInColumns = (img: PixelImage, from: number, to: number) => {
  let n = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = from; x < to; x++) if (img.data[(y * img.width + x) * 4 + 3] > 0) n++;
  }
  return n;
};
const whitePixelColumns = (img: PixelImage) => {
  const columns: number[] = [];
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const o = (y * img.width + x) * 4;
      if (img.data[o] === 252 && img.data[o + 1] === 252 && img.data[o + 2] === 252)
        columns.push(x);
    }
  }
  return columns;
};

describe('sprite art', () => {
  it('builds every creature variant as a valid 8x8 image', () => {
    for (let i = 0; i < HUE_COLUMN_COUNT; i++) {
      for (const frame of [0, 1] as const) {
        for (const left of [false, true]) {
          const img = creatureImage((i + 0.5) / HUE_COLUMN_COUNT, frame, left);
          expect(is8x8(img)).toBe(true);
          expect(opaqueCount(img)).toBeGreaterThan(30);
        }
      }
    }
  });

  it('draws the eye on the side the creature faces', () => {
    const right = whitePixelColumns(creatureImage(0.5, 0, false));
    const left = whitePixelColumns(creatureImage(0.5, 0, true));
    expect(right.length).toBeGreaterThan(0);
    expect(right.every((x) => x >= 4)).toBe(true);
    expect(left.every((x) => x < 4)).toBe(true);
  });

  it('animates the walk by changing only the legs', () => {
    const a = creatureImage(0.5, 0, false);
    const b = creatureImage(0.5, 1, false);
    expect(Array.from(a.data)).not.toEqual(Array.from(b.data));
    // The body (top five rows) is identical in both frames.
    expect(Array.from(a.data.subarray(0, 8 * 5 * 4))).toEqual(
      Array.from(b.data.subarray(0, 8 * 5 * 4)),
    );
  });

  it('gives different hues different colours', () => {
    expect(Array.from(creatureImage(0.05, 0, false).data)).not.toEqual(
      Array.from(creatureImage(0.55, 0, false).data),
    );
  });

  it('makes terrain tiles that are fully opaque', () => {
    for (let v = 0; v < 4; v++) {
      expect(is8x8(groundImage(v))).toBe(true);
      expect(opaqueCount(groundImage(v))).toBe(64);
    }
    for (let f = 0; f < 2; f++) expect(opaqueCount(waterImage(f))).toBe(64);
    expect(opaqueCount(rockImage())).toBe(64);
  });

  it('keeps water frames different so it can shimmer', () => {
    expect(Array.from(waterImage(0).data)).not.toEqual(Array.from(waterImage(1).data));
  });

  it('shows more plant the more food there is', () => {
    const [sprout, tuft, bush] = plantImages();
    expect([sprout, tuft, bush].every(is8x8)).toBe(true);
    expect(opaqueCount(sprout)).toBeLessThan(opaqueCount(tuft));
    expect(opaqueCount(tuft)).toBeLessThan(opaqueCount(bush));
  });

  it('draws full, half and empty hearts that differ', () => {
    const { full, half, empty } = heartImages();
    for (const h of [full, half, empty]) expect(is8x8(h)).toBe(true);
    expect(Array.from(full.data)).not.toEqual(Array.from(half.data));
    expect(Array.from(half.data)).not.toEqual(Array.from(empty.data));
    // A half heart is filled on the left only: its left half is red, its right half is the empty colour.
    expect(opaquePixelsInColumns(half, 0, 4)).toBeGreaterThan(0);
  });

  it('has three frames for each effect', () => {
    expect(sparkleImages().length).toBe(3);
    expect(puffImages().length).toBe(3);
    for (const img of [...sparkleImages(), ...puffImages()]) {
      expect(is8x8(img)).toBe(true);
      expect(opaqueCount(img)).toBeGreaterThan(0);
    }
  });

  it('draws predators differently from plant eaters, with a red pupil, still facing the right way', () => {
    const plain = creatureImage(0.5, 0, false, false);
    const predator = creatureImage(0.5, 0, false, true);
    expect(is8x8(predator)).toBe(true);
    expect(Array.from(predator.data)).not.toEqual(Array.from(plain.data));
    const red = (img: PixelImage) => {
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i] === 248 && img.data[i + 1] === 56 && img.data[i + 2] === 0) n++;
      }
      return n;
    };
    expect(red(predator)).toBe(1);
    expect(red(plain)).toBe(0);
    const flipped = creatureImage(0.5, 0, true, true);
    expect(whitePixelColumns(flipped).every((x) => x < 4)).toBe(true);
    // Both walk frames exist for predators too.
    expect(Array.from(creatureImage(0.5, 1, false, true).data)).not.toEqual(
      Array.from(predator.data),
    );
  });

  it('has two frames for the bite hit', () => {
    expect(hitImages().length).toBe(2);
    for (const img of hitImages()) expect(opaqueCount(img)).toBeGreaterThan(0);
  });
});
