import type { HistoryData, SeriesName } from '../sim/history';
import { traitRange } from '../sim/genome';
import type { SpeciesInfo } from '../sim/species';
import { dietClass } from '../sim/species';
import { COLORS, nes, type RGB } from './palette';
import { line, type Surface } from './surface';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const CHART_WIDTH = 256;
export const CHART_HEIGHTS = {
  population: 64,
  traits: 64,
  species: 48,
  diet: 56,
  tree: 128,
} as const;

const TITLE_H = 10;
const PAD = 3;

const SERIES_COLORS = {
  population: COLORS.white,
  carnivores: COLORS.red,
  species: nes(0x2a),
  size: COLORS.white,
  speed: nes(0x28),
  vision: nes(0x2c),
  diet: COLORS.red,
} as const;

export const DIET_COLORS: Record<ReturnType<typeof dietClass>, RGB> = {
  HERBIVORE: nes(0x1a),
  OMNIVORE: nes(0x28),
  HUNTER: nes(0x16),
};

/** Clear the surface, draw a border and a title, and return the area left for the plot. */
export function frame(s: Surface, title: string, right = ''): Rect {
  s.rect(0, 0, s.width, s.height, COLORS.black);
  const border = COLORS.blueDark;
  s.rect(0, 0, s.width, 1, border);
  s.rect(0, s.height - 1, s.width, 1, border);
  s.rect(0, 0, 1, s.height, border);
  s.rect(s.width - 1, 0, 1, s.height, border);
  s.text(title, PAD, 2, COLORS.grayLight);
  if (right) s.text(right, s.width - PAD - right.length * 8, 2, COLORS.white);
  return { x: PAD, y: TITLE_H + 3, w: s.width - 2 * PAD, h: s.height - TITLE_H - 3 - PAD };
}

/** Pixel position of a value in a plot: x from the sample index, y from the value. */
export function plotPoint(
  area: Rect,
  index: number,
  count: number,
  value: number,
  min: number,
  max: number,
): [number, number] {
  const x = count <= 1 ? area.x : area.x + Math.round((index * (area.w - 1)) / (count - 1));
  const t = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  return [x, area.y + area.h - 1 - Math.round(t * (area.h - 1))];
}

function plotSeries(
  s: Surface,
  area: Rect,
  values: ArrayLike<number>,
  count: number,
  min: number,
  max: number,
  color: RGB,
): void {
  let prev: [number, number] | null = null;
  for (let i = 0; i < count; i++) {
    const p = plotPoint(area, i, count, values[i], min, max);
    if (prev) line(s, prev[0], prev[1], p[0], p[1], color);
    else s.rect(p[0], p[1], 1, 1, color);
    prev = p;
  }
}

function last(history: HistoryData, name: SeriesName): number {
  return history.length === 0 ? 0 : history.series[name][history.length - 1];
}

function maxOf(values: ArrayLike<number>, count: number): number {
  let m = 0;
  for (let i = 0; i < count; i++) if (values[i] > m) m = values[i];
  return m;
}

/** Population over time, with the share that are hunters scaled to the same height. */
export function drawPopulation(s: Surface, history: HistoryData): void {
  const area = frame(s, 'POPULATION', String(Math.round(last(history, 'population'))));
  const top = Math.max(10, maxOf(history.series.population, history.length) * 1.1);
  plotSeries(s, area, history.series.carnivores, history.length, 0, 1, SERIES_COLORS.carnivores);
  plotSeries(s, area, history.series.population, history.length, 0, top, SERIES_COLORS.population);
}

/** How the average creature's body and diet changed, each trait scaled to its own range. */
export function drawTraits(s: Surface, history: HistoryData): void {
  const area = frame(s, 'TRAITS');
  const names = ['size', 'speed', 'vision', 'diet'] as const;
  names.forEach((name, i) => {
    const { min, max } = traitRange(
      name === 'speed' ? 'maxSpeed' : name === 'vision' ? 'visionRange' : name,
    );
    plotSeries(s, area, history.series[name], history.length, min, max, SERIES_COLORS[name]);
    const x = 96 + i * 40;
    s.rect(x, 3, 6, 6, SERIES_COLORS[name]);
    s.text(['SZ', 'SP', 'VI', 'DT'][i], x + 8, 2, COLORS.grayLight);
  });
}

/** Number of species alive over time. */
export function drawSpeciesCount(s: Surface, history: HistoryData): void {
  const area = frame(s, 'SPECIES ALIVE', String(Math.round(last(history, 'species'))));
  const top = Math.max(5, maxOf(history.series.species, history.length));
  plotSeries(s, area, history.series.species, history.length, 0, top, SERIES_COLORS.species);
}

/** How many creatures have each diet, from plant eaters on the left to hunters on the right. */
export function drawDietHistogram(s: Surface, bins: readonly number[]): void {
  const area = frame(s, 'DIET NOW', 'PLANTS>MEAT');
  const top = Math.max(1, ...bins);
  const slot = area.w / bins.length;
  bins.forEach((count, i) => {
    const h = Math.round((count / top) * (area.h - 1));
    const x = area.x + Math.floor(i * slot);
    const w = Math.max(1, Math.floor(slot) - 1);
    const color = DIET_COLORS[dietClass((i + 0.5) / bins.length)];
    s.rect(x, area.y + area.h - h, w, h, color);
  });
}

/** Rows shown in the species tree: the founders plus the biggest of the rest. */
export function treeRows(species: readonly SpeciesInfo[], maxRows: number): SpeciesInfo[] {
  if (species.length <= maxRows)
    return [...species].sort((a, b) => a.bornTick - b.bornTick || a.id - b.id);
  const bigger = (a: SpeciesInfo, b: SpeciesInfo) => b.peak - a.peak || a.id - b.id;
  // Species with no parent are the founders, and migrants that fit no species they arrived among.
  // There can be more of them than there are rows, so they are cut to the biggest as well.
  const root = species
    .filter((sp) => sp.parentId === null)
    .sort(bigger)
    .slice(0, maxRows);
  const rest = species
    .filter((sp) => sp.parentId !== null)
    .sort(bigger)
    .slice(0, maxRows - root.length);
  return [...root, ...rest].sort((a, b) => a.bornTick - b.bornTick || a.id - b.id);
}

/**
 * The family tree of species: time runs left to right, each species is a bar
 * from its birth to its extinction (or now), coloured by diet, joined to its
 * parent by a vertical line where it branched off.
 */
export function drawSpeciesTree(s: Surface, species: readonly SpeciesInfo[], tick: number): void {
  const alive = species.filter((sp) => sp.count > 0).length;
  const area = frame(s, 'SPECIES TREE', `${alive}/${species.length}`);
  if (species.length === 0 || tick <= 0) return;
  const maxRows = Math.floor(area.h / 5);
  const rows = treeRows(species, maxRows);
  const rowHeight = area.h / rows.length;
  const rowOf = new Map(rows.map((sp, i) => [sp.id, i]));
  const xAt = (t: number) => area.x + Math.round((Math.min(t, tick) / tick) * (area.w - 1));
  const yAt = (row: number) => area.y + Math.round(row * rowHeight + rowHeight / 2);
  const barHeight = Math.max(1, Math.min(4, Math.floor(rowHeight) - 1));

  for (const sp of rows) {
    const row = rowOf.get(sp.id)!;
    const x0 = xAt(sp.bornTick);
    const x1 = xAt(sp.extinctTick ?? tick);
    const color = sp.count > 0 ? DIET_COLORS[dietClass(sp.diet)] : COLORS.grayDark;
    if (sp.parentId !== null && rowOf.has(sp.parentId)) {
      line(s, x0, yAt(rowOf.get(sp.parentId)!), x0, yAt(row), COLORS.grayLight);
    }
    s.rect(x0, yAt(row) - (barHeight >> 1), Math.max(2, x1 - x0 + 1), barHeight, color);
  }
}
