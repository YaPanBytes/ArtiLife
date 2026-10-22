import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Renderer } from '../src/render/renderer';
import type { Analysis, WorldInfo } from '../src/runtime/types';
import type { SimEvent } from '../src/sim/events';

/** A canvas context that accepts any drawing call, enough to build a Renderer without a browser. */
function fakeContext(): object {
  return new Proxy(
    {},
    {
      get: (_, name) =>
        name === 'createImageData'
          ? (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) })
          : () => undefined,
      set: () => true,
    },
  );
}

const fakeCanvas = () => ({ width: 0, height: 0, getContext: fakeContext });

const world: WorldInfo = { width: 2, height: 2, terrain: new Uint8Array(4) };
const event = (tick: number, text: string, major = true): SimEvent => ({
  tick,
  kind: 'info',
  text,
  major,
});
const analysis = (...events: SimEvent[]): Analysis => ({
  version: 1,
  history: { ticks: new Float64Array(0), length: 0, series: {} as never, version: 0 },
  species: [],
  events,
  dietHistogram: [],
});

describe('headlines', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { createElement: fakeCanvas });
    vi.stubGlobal('ImageData', class {});
  });
  afterEach(() => vi.unstubAllGlobals());

  const make = () => {
    const renderer = new Renderer(fakeCanvas() as unknown as HTMLCanvasElement);
    const take = (a: Analysis) => renderer['takeHeadlines'](a);
    const shown = () => renderer['headlines'].map((h) => h.text);
    return { renderer, take, shown };
  };

  it('announces major events as they happen, and only those', () => {
    const { take, shown } = make();
    take(analysis(event(10, 'A PLAGUE', true), event(11, 'MILESTONE', false)));
    expect(shown()).toEqual(['A PLAGUE']);
    take(analysis(event(10, 'A PLAGUE'), event(11, 'MILESTONE', false), event(30, 'A METEOR')));
    expect(shown()).toEqual(['A PLAGUE', 'A METEOR']);
  });

  it('does not replay the log of a world that was just loaded', () => {
    const { renderer, take, shown } = make();
    const stale = analysis(event(5, 'OLD WORLD NEWS'));
    renderer.setWorld(world, stale);
    // The worker has not sent the loaded world's picture yet: the old one is not news either.
    take(stale);
    expect(shown()).toEqual([]);
    const loaded = analysis(event(900, 'SAVED EARLIER'), event(950, 'ALSO SAVED'));
    take(loaded);
    expect(shown()).toEqual([]);
    // What happens after that is news.
    take(analysis(event(900, 'SAVED EARLIER'), event(950, 'ALSO SAVED'), event(1000, 'A DROUGHT')));
    expect(shown()).toEqual(['A DROUGHT']);
  });
});
