import { describe, expect, it } from 'vitest';
import {
  CHART_HEIGHTS,
  CHART_WIDTH,
  DIET_COLORS,
  drawDietHistogram,
  drawPopulation,
  drawSpeciesCount,
  drawSpeciesTree,
  drawTraits,
  frame,
  plotPoint,
  treeRows,
} from '../src/render/charts';
import { COLORS } from '../src/render/palette';
import { BufferSurface, line } from '../src/render/surface';
import { HISTORY_SERIES, History, type HistoryData, type Sample } from '../src/sim/history';
import type { SpeciesInfo } from '../src/sim/species';

describe('line', () => {
  it('includes both ends and leaves no gaps on a diagonal', () => {
    const s = new BufferSurface(10, 10);
    line(s, 1, 1, 6, 6, COLORS.white);
    expect(s.at(1, 1)).toEqual(COLORS.white);
    expect(s.at(6, 6)).toEqual(COLORS.white);
    expect(s.count(COLORS.white)).toBe(6);
  });

  it('draws steep, flat and backwards lines', () => {
    const s = new BufferSurface(10, 10);
    line(s, 2, 8, 2, 1, COLORS.red);
    expect(s.count(COLORS.red)).toBe(8);
    const t = new BufferSurface(10, 10);
    line(t, 8, 3, 0, 3, COLORS.red);
    expect(t.count(COLORS.red)).toBe(9);
    const u = new BufferSurface(10, 10);
    line(u, 4, 4, 4, 4, COLORS.red);
    expect(u.count(COLORS.red)).toBe(1);
  });
});

describe('frame and plotPoint', () => {
  it('draws a border and a title and returns a plot area inside the surface', () => {
    const s = new BufferSurface(CHART_WIDTH, 64);
    const area = frame(s, 'HELLO', '42');
    expect(s.texts.map((t) => t.str)).toEqual(['HELLO', '42']);
    expect(s.at(0, 0)).toEqual(COLORS.blueDark);
    expect(s.at(CHART_WIDTH - 1, 63)).toEqual(COLORS.blueDark);
    expect(s.at(10, 40)).toEqual(COLORS.black);
    expect(area.x).toBeGreaterThan(0);
    expect(area.x + area.w).toBeLessThan(CHART_WIDTH);
    expect(area.y + area.h).toBeLessThan(64);
    expect(area.y).toBeGreaterThan(8);
  });

  it('maps values to the plot: low at the bottom, high at the top, clamped', () => {
    const area = { x: 10, y: 20, w: 101, h: 51 };
    expect(plotPoint(area, 0, 11, 0, 0, 100)).toEqual([10, 70]);
    expect(plotPoint(area, 10, 11, 100, 0, 100)).toEqual([110, 20]);
    expect(plotPoint(area, 5, 11, 50, 0, 100)).toEqual([60, 45]);
    expect(plotPoint(area, 0, 11, -5, 0, 100)[1]).toBe(70);
    expect(plotPoint(area, 0, 11, 500, 0, 100)[1]).toBe(20);
    expect(plotPoint(area, 0, 1, 10, 0, 100)[0]).toBe(10);
    expect(plotPoint(area, 0, 5, 10, 5, 5)[1]).toBe(70);
  });
});

function history(values: (i: number) => Partial<Sample>, n = 30): HistoryData {
  const h = new History(64, 1);
  for (let i = 0; i < n; i++) {
    const sample = Object.fromEntries(HISTORY_SERIES.map((k) => [k, 0])) as Sample;
    h.record(i + 1, { ...sample, ...values(i) });
  }
  return h.data();
}

describe('time charts', () => {
  it('draw a rising population from bottom left to top right', () => {
    const s = new BufferSurface(CHART_WIDTH, CHART_HEIGHTS.population);
    drawPopulation(
      s,
      history((i) => ({ population: 10 + i * 10 })),
    );
    const area = frame(new BufferSurface(CHART_WIDTH, CHART_HEIGHTS.population), '');
    // The line ends at the right edge near the top, and starts at the left lower down.
    let lastY = -1;
    let firstY = -1;
    for (let y = area.y; y < area.y + area.h; y++) {
      if (s.at(area.x + area.w - 1, y)?.[0] === 252) lastY = lastY < 0 ? y : lastY;
      if (s.at(area.x, y)?.[0] === 252) firstY = y;
    }
    expect(lastY).toBeGreaterThanOrEqual(0);
    expect(lastY).toBeLessThan(firstY);
    expect(s.texts[0].str).toBe('POPULATION');
    expect(s.texts[1].str).toBe('300');
  });

  it('draw the hunter share in red', () => {
    const s = new BufferSurface(CHART_WIDTH, CHART_HEIGHTS.population);
    drawPopulation(
      s,
      history((i) => ({ population: 100, carnivores: i / 30 })),
    );
    expect(s.count(COLORS.red)).toBeGreaterThan(10);
  });

  it('draw each trait in its own colour and a legend', () => {
    const s = new BufferSurface(CHART_WIDTH, CHART_HEIGHTS.traits);
    drawTraits(
      s,
      history(() => ({ size: 0.6, speed: 0.2, vision: 8, diet: 0.95 })),
    );
    expect(s.texts.map((t) => t.str)).toEqual(['TRAITS', 'SZ', 'SP', 'VI', 'DT']);
    const colours = new Set<string>();
    for (let x = 0; x < CHART_WIDTH; x++) {
      for (let y = 14; y < CHART_HEIGHTS.traits - 3; y++) {
        const p = s.at(x, y);
        if (p && p[0] + p[1] + p[2] > 0 && p[2] !== 188) colours.add(p.join(','));
      }
    }
    expect(colours.size).toBeGreaterThanOrEqual(4);
  });

  it('draw species counts and cope with an empty history', () => {
    const s = new BufferSurface(CHART_WIDTH, CHART_HEIGHTS.species);
    drawSpeciesCount(
      s,
      history((i) => ({ species: 1 + (i % 4) })),
    );
    expect(s.texts[0].str).toBe('SPECIES ALIVE');
    const empty = new BufferSurface(CHART_WIDTH, CHART_HEIGHTS.population);
    expect(() => drawPopulation(empty, new History(8, 1).data())).not.toThrow();
    expect(() => drawTraits(empty, new History(8, 1).data())).not.toThrow();
  });
});

describe('drawDietHistogram', () => {
  it('draws the tallest bin to the top of the plot, coloured by diet class', () => {
    const s = new BufferSurface(CHART_WIDTH, CHART_HEIGHTS.diet);
    drawDietHistogram(s, [50, 10, 0, 0, 30, 0, 0, 0, 0, 25]);
    expect(s.count(DIET_COLORS.HERBIVORE)).toBeGreaterThan(0);
    expect(s.count(DIET_COLORS.HUNTER)).toBeGreaterThan(0);
    expect(s.count(DIET_COLORS.OMNIVORE)).toBeGreaterThan(0);
    // Taller bins have more pixels.
    const small = new BufferSurface(CHART_WIDTH, CHART_HEIGHTS.diet);
    drawDietHistogram(small, [50, 0, 0, 0, 0, 0, 0, 0, 0, 5]);
    expect(small.count(DIET_COLORS.HERBIVORE)).toBeGreaterThan(small.count(DIET_COLORS.HUNTER));
  });

  it('draws nothing for an empty population', () => {
    const s = new BufferSurface(CHART_WIDTH, CHART_HEIGHTS.diet);
    drawDietHistogram(s, new Array(10).fill(0));
    expect(s.count(DIET_COLORS.HERBIVORE)).toBe(0);
  });
});

const species = (
  id: number,
  parentId: number | null,
  born: number,
  extra: Partial<SpeciesInfo> = {},
): SpeciesInfo => ({
  id,
  parentId,
  bornTick: born,
  extinctTick: null,
  count: 5,
  peak: 5,
  diet: 0.05,
  hue: 0.5,
  ...extra,
});

describe('species tree', () => {
  it('keeps every species when there are few, oldest first', () => {
    const rows = treeRows([species(2, 1, 50), species(1, null, 0)], 10);
    expect(rows.map((s) => s.id)).toEqual([1, 2]);
  });

  it('keeps the founders and the biggest others when there are too many', () => {
    const all = [
      species(1, null, 0),
      ...Array.from({ length: 20 }, (_, i) => species(i + 2, 1, 10 + i, { peak: i })),
    ];
    const rows = treeRows(all, 6);
    expect(rows).toHaveLength(6);
    expect(rows[0].id).toBe(1);
    expect(rows.map((s) => s.peak).filter((p) => p >= 15).length).toBe(5);
  });

  it('never shows more rows than fit, even when there are more founders than that', () => {
    // Migrants that fit no species here found ones with no parent, so roots can pile up.
    const roots = Array.from({ length: 30 }, (_, i) => species(i + 1, null, i * 10, { peak: i }));
    const rows = treeRows([...roots, species(99, 1, 500)], 8);
    expect(rows).toHaveLength(8);
    // The biggest ones are the ones kept.
    expect(rows.every((s) => s.peak >= 22 || s.id === 99)).toBe(true);
  });

  it('draws bars coloured by diet, grey once extinct, joined to their parent', () => {
    const s = new BufferSurface(CHART_WIDTH, CHART_HEIGHTS.tree);
    drawSpeciesTree(
      s,
      [
        species(1, null, 0),
        species(2, 1, 400, { diet: 0.9 }),
        species(3, 1, 200, { diet: 0.4, extinctTick: 600, count: 0 }),
      ],
      1000,
    );
    expect(s.count(DIET_COLORS.HERBIVORE)).toBeGreaterThan(100);
    expect(s.count(DIET_COLORS.HUNTER)).toBeGreaterThan(20);
    expect(s.count(COLORS.grayDark)).toBeGreaterThan(20);
    expect(s.count(COLORS.grayLight)).toBeGreaterThan(5); // the branch lines
    expect(s.texts[1].str).toBe('2/3');
  });

  it('does not crash with no species or at tick 0', () => {
    const s = new BufferSurface(CHART_WIDTH, CHART_HEIGHTS.tree);
    expect(() => drawSpeciesTree(s, [], 0)).not.toThrow();
    expect(() => drawSpeciesTree(s, [species(1, null, 0)], 0)).not.toThrow();
  });
});
