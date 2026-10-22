import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Camera } from '../src/render/camera';
import { FIELD_H, FIELD_W, TILE } from '../src/render/layout';
import { Renderer } from '../src/render/renderer';
import { Scene, type Analysis, type WorldInfo } from '../src/runtime/types';

interface FakeCanvas {
  width: number;
  height: number;
  /** Names of the drawing calls made on this canvas, in order. */
  calls: string[];
  drawn: unknown[][];
  getContext(): object;
}

/** A canvas that records what is drawn onto it, enough to count work without a browser. */
function fakeCanvas(): FakeCanvas {
  const canvas: FakeCanvas = {
    width: 0,
    height: 0,
    calls: [],
    drawn: [],
    getContext: () =>
      new Proxy(
        {},
        {
          get: (_, name) => {
            if (name === 'createImageData')
              return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
            return (...args: unknown[]) => {
              canvas.calls.push(String(name));
              if (name === 'drawImage') canvas.drawn.push(args);
            };
          },
          set: () => true,
        },
      ),
  };
  return canvas;
}

describe('terrain drawing', () => {
  const canvases: FakeCanvas[] = [];
  beforeEach(() => {
    canvases.length = 0;
    vi.stubGlobal('document', {
      createElement: () => {
        const c = fakeCanvas();
        canvases.push(c);
        return c;
      },
    });
    vi.stubGlobal('ImageData', class {});
  });
  afterEach(() => vi.unstubAllGlobals());

  const world: WorldInfo = { width: 64, height: 64, terrain: new Uint8Array(64 * 64) };
  const analysis = {
    version: 1,
    history: { ticks: new Float64Array(0), length: 0, series: {}, version: 0 },
    species: [],
    events: [],
    dietHistogram: [],
  } as unknown as Analysis;

  function setup() {
    const screen = fakeCanvas();
    const renderer = new Renderer(screen as unknown as HTMLCanvasElement);
    renderer.setWorld(world, analysis);
    const scene = new Scene();
    scene.maxFood = 10;
    scene.food = new Float32Array(64 * 64).fill(5);
    const camera = new Camera(64, 64);
    const view = {
      camera,
      selectedId: null,
      paused: false,
      mode: 'tile',
      overlay: 'none',
    } as const;
    const render = () => renderer.render(scene, world, null, analysis, view);
    // Everything drawn so far onto the off-screen map: the canvas as big as the whole world.
    const mapDraws = () =>
      canvases.find((c) => c.width === 64 * TILE && c.height === 64 * TILE)?.drawn.length ?? 0;
    return { screen, scene, camera, render, mapDraws };
  }

  it('paints each visible tile once, then only the tiles that change', () => {
    const { scene, render, mapDraws } = setup();
    render();
    const visible = (FIELD_W / TILE + 1) * (FIELD_H / TILE + 1);
    expect(mapDraws()).toBe(visible);

    render();
    expect(mapDraws()).toBe(visible); // nothing changed: nothing painted

    scene.food[3 * 64 + 4] = 10; // a visible tile grows from a tuft to a bush
    render();
    expect(mapDraws()).toBe(visible + 1);
  });

  it('paints tiles when they scroll into view, and not before', () => {
    const { camera, render, mapDraws } = setup();
    render();
    const before = mapDraws();
    camera.pan(TILE * 4, 0); // four more columns come into view
    render();
    const rows = FIELD_H / TILE + 1;
    expect(mapDraws()).toBe(before + 4 * rows);
  });

  it('puts the map on screen with a few copies, wherever the camera is', () => {
    const { screen, camera, render } = setup();
    for (const [x, y] of [
      [0, 0],
      [100, 37],
      [64 * TILE - 10, 64 * TILE - 5],
    ] as const) {
      camera.x = x;
      camera.y = y;
      screen.drawn.length = 0;
      render();
      // Copies of the map: those whose source is a canvas rather than a sprite.
      const copies = screen.drawn.filter((args) => args.length === 9);
      expect(copies.length).toBeGreaterThanOrEqual(1);
      expect(copies.length).toBeLessThanOrEqual(4);
      const area = copies.reduce((sum, a) => sum + (a[3] as number) * (a[4] as number), 0);
      expect(area).toBe(FIELD_W * FIELD_H);
    }
  });
});
