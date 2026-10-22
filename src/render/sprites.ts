import * as art from './art';
import { COLORS, HUE_COLUMN_COUNT, creatureColors, nes, type RGB } from './palette';
import { flipHorizontal, renderPattern, scaleUp, type PixelImage } from './pixel';

/** A drawable sprite: the canvas holding it, ready for drawImage. */
export type Sprite = HTMLCanvasElement;

function toCanvas(img: PixelImage): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return canvas;
}

// Pure image builders (no DOM), exported so the art can be tested.

export function creatureImage(
  hue: number,
  frame: 0 | 1,
  facingLeft: boolean,
  predator = false,
): PixelImage {
  const { body, shade } = creatureColors(hue);
  const rows = predator
    ? frame === 0
      ? art.PREDATOR_WALK_A
      : art.PREDATOR_WALK_B
    : frame === 0
      ? art.CREATURE_WALK_A
      : art.CREATURE_WALK_B;
  const img = renderPattern(rows, {
    '1': COLORS.black,
    '2': body,
    '3': shade,
    '4': COLORS.white,
    '5': COLORS.black,
    '6': COLORS.red,
  });
  return facingLeft ? flipHorizontal(img) : img;
}

const GROUND_LEGEND: Record<string, RGB> = { '1': COLORS.groundSpeck };
const GROUND_BASE: RGB = COLORS.ground;

export function groundImage(variant: number): PixelImage {
  const speck = renderPattern(art.GROUND_VARIANTS[variant], GROUND_LEGEND);
  return fillBackground(speck, GROUND_BASE);
}

export function waterImage(frame: number): PixelImage {
  const ripples = renderPattern(art.WATER_FRAMES[frame], { '1': COLORS.waterSpeck });
  return fillBackground(ripples, COLORS.water);
}

export function rockImage(): PixelImage {
  const rock = renderPattern(art.ROCK, {
    '1': COLORS.rockDark,
    '2': COLORS.rock,
    '3': COLORS.rockLight,
  });
  return fillBackground(rock, COLORS.ground);
}

const PLANT_LEGEND: Record<string, RGB> = {
  '1': COLORS.greenDark,
  '2': COLORS.green,
  '3': COLORS.greenLight,
  r: COLORS.red,
};

export const plantImages = (): PixelImage[] =>
  [art.PLANT_SPROUT, art.PLANT_TUFT, art.PLANT_BUSH].map((rows) =>
    renderPattern(rows, PLANT_LEGEND),
  );

export const heartImages = () => {
  const legend = { '1': COLORS.red, '2': COLORS.white, '3': COLORS.grayDark };
  return {
    full: renderPattern(art.HEART_FULL, legend),
    half: renderPattern(art.HEART_HALF, legend),
    empty: renderPattern(art.HEART_EMPTY, legend),
  };
};

export const sparkleImages = (): PixelImage[] =>
  art.SPARKLE_FRAMES.map((rows) => renderPattern(rows, { '1': COLORS.white, '2': nes(0x28) }));

export const hitImages = (): PixelImage[] =>
  art.HIT_FRAMES.map((rows) => renderPattern(rows, { '1': COLORS.white, '2': COLORS.red }));

export const puffImages = (): PixelImage[] =>
  art.PUFF_FRAMES.map((rows) =>
    renderPattern(rows, { '1': COLORS.grayLight, '2': COLORS.grayDark }),
  );

/** Paint a transparent-background image over a solid colour. */
function fillBackground(img: PixelImage, background: RGB): PixelImage {
  const data = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const opaque = img.data[i + 3] > 0;
    const src = opaque ? img.data : null;
    data[i] = src ? src[i] : background[0];
    data[i + 1] = src ? src[i + 1] : background[1];
    data[i + 2] = src ? src[i + 2] : background[2];
    data[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data };
}

/** Pre-rendered sprites, built once in the browser. */
export class Atlas {
  readonly ground = Array.from({ length: art.GROUND_VARIANTS.length }, (_, i) =>
    toCanvas(groundImage(i)),
  );
  readonly water = Array.from({ length: art.WATER_FRAMES.length }, (_, i) =>
    toCanvas(waterImage(i)),
  );
  readonly rock = toCanvas(rockImage());
  /** Sprout, tuft, bush: increasing food. */
  readonly plants = plantImages().map(toCanvas);
  readonly hearts = {
    full: toCanvas(heartImages().full),
    half: toCanvas(heartImages().half),
    empty: toCanvas(heartImages().empty),
  };
  readonly sparkle = sparkleImages().map(toCanvas);
  readonly puff = puffImages().map(toCanvas);
  readonly hit = hitImages().map(toCanvas);
  private readonly creatureCache = new Map<number, Sprite>();

  /**
   * A creature sprite. Hues are snapped to the palette, so there are only a few
   * dozen distinct sprites. Large creatures use the same art at double size.
   */
  creature(
    hue: number,
    frame: 0 | 1,
    facingLeft: boolean,
    large: boolean,
    predator = false,
  ): Sprite {
    const column = Math.min(HUE_COLUMN_COUNT - 1, Math.floor(hue * HUE_COLUMN_COUNT));
    const key =
      (((column * 2 + frame) * 2 + (facingLeft ? 1 : 0)) * 2 + (large ? 1 : 0)) * 2 +
      (predator ? 1 : 0);
    let sprite = this.creatureCache.get(key);
    if (!sprite) {
      // Use the middle of the hue bucket so the column matches `column`.
      const img = creatureImage((column + 0.5) / HUE_COLUMN_COUNT, frame, facingLeft, predator);
      sprite = toCanvas(large ? scaleUp(img, 2) : img);
      this.creatureCache.set(key, sprite);
    }
    return sprite;
  }
}
