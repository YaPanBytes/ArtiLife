import { describe, expect, it } from 'vitest';
import { flipHorizontal, opaqueCount, renderPattern, scaleUp } from '../src/render/pixel';

const legend = { a: [10, 20, 30], b: [200, 100, 50] } as const;
const px = (img: ReturnType<typeof renderPattern>, x: number, y: number) =>
  Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

describe('renderPattern', () => {
  const img = renderPattern(['a.b', '.ba'], legend);

  it('builds an image of the right size', () => {
    expect(img.width).toBe(3);
    expect(img.height).toBe(2);
    expect(img.data.length).toBe(3 * 2 * 4);
  });

  it('paints legend colours opaque and leaves dots transparent', () => {
    expect(px(img, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(px(img, 2, 0)).toEqual([200, 100, 50, 255]);
    expect(px(img, 1, 0)[3]).toBe(0);
    expect(opaqueCount(img)).toBe(4);
  });

  it('rejects ragged rows and characters missing from the legend', () => {
    expect(() => renderPattern(['aa', 'a'], legend)).toThrow(/row 1/);
    expect(() => renderPattern(['az'], legend)).toThrow(/'z'/);
  });
});

describe('flipHorizontal and scaleUp', () => {
  const img = renderPattern(['ab.'], legend);

  it('mirrors left to right without changing size', () => {
    const flipped = flipHorizontal(img);
    expect(flipped.width).toBe(3);
    expect(px(flipped, 2, 0)).toEqual(px(img, 0, 0));
    expect(px(flipped, 1, 0)).toEqual(px(img, 1, 0));
    expect(px(flipped, 0, 0)[3]).toBe(0);
    expect(flipHorizontal(flipped).data).toEqual(img.data);
  });

  it('enlarges by whole blocks', () => {
    const big = scaleUp(img, 2);
    expect(big.width).toBe(6);
    expect(big.height).toBe(2);
    expect(px(big, 0, 0)).toEqual(px(big, 1, 1));
    expect(px(big, 2, 0)).toEqual(px(img, 1, 0));
    expect(opaqueCount(big)).toBe(opaqueCount(img) * 4);
  });
});
