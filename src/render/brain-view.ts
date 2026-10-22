import type { BrainGraph } from '../sim/brain-graph';
import { LAYER_HIDDEN, LAYER_INPUT, LAYER_OUTPUT, outputLabels } from '../sim/brain-graph';
import { RAY_CHANNELS, RAY_COUNT } from '../sim/senses';
import { COLORS, nes, type RGB } from './palette';
import { frame } from './charts';
import { line, type Surface } from './surface';

export const BRAIN_VIEW_HEIGHT = 168;

/** Neuron colours by activation: blue when negative, grey when quiet, yellow when positive. */
const POSITIVE: readonly RGB[] = [COLORS.grayDark, COLORS.grayLight, nes(0x38), nes(0x28)];
const NEGATIVE: readonly RGB[] = [COLORS.grayDark, nes(0x12), nes(0x22), nes(0x21)];

export function activationColor(v: number): RGB {
  const level = Math.abs(v) < 0.1 ? 0 : Math.abs(v) < 0.4 ? 1 : Math.abs(v) < 0.7 ? 2 : 3;
  return (v >= 0 ? POSITIVE : NEGATIVE)[level];
}

/** Most connections drawn, strongest first; the rest would only be clutter. */
const MAX_EDGES = 140;
/** A connection is drawn bright when what it carries right now is at least this big. */
const ACTIVE_FLOW = 0.15;

/** Where each neuron is drawn, laid out in three columns. */
export function layoutBrain(graph: BrainGraph, width: number, height: number): [number, number][] {
  const columns = {
    [LAYER_INPUT]: 46,
    [LAYER_HIDDEN]: Math.round(width * 0.55),
    [LAYER_OUTPUT]: width - 52,
  };
  const top = 14;
  const usable = height - top - 4;
  const counts = [0, 0, 0];
  for (const layer of graph.nodeLayer) counts[layer]++;
  const seen = [0, 0, 0];
  return Array.from(graph.nodeLayer, (layer) => {
    const index = seen[layer]++;
    const y = top + Math.round(((index + 0.5) * usable) / counts[layer]);
    return [columns[layer as 0 | 1 | 2], y] as [number, number];
  });
}

/**
 * Draw a creature's brain: sensors on the left, hidden neurons in the middle,
 * actions on the right. Lines are red for positive weights and blue for
 * negative; the ones carrying signal right now are bright.
 */
export function drawBrain(s: Surface, graph: BrainGraph): void {
  frame(s, 'BRAIN');
  const pos = layoutBrain(graph, s.width, s.height);

  // Strongest connections only, dim unless they are carrying something now.
  const order = Array.from(graph.edgeWeight.keys()).sort(
    (a, b) => Math.abs(graph.edgeWeight[b]) - Math.abs(graph.edgeWeight[a]),
  );
  for (const e of order.slice(0, MAX_EDGES)) {
    const w = graph.edgeWeight[e];
    const from = graph.edgeFrom[e];
    const flow = Math.abs(w * graph.nodeValue[from]);
    const active = flow >= ACTIVE_FLOW;
    const color = w > 0 ? (active ? nes(0x16) : nes(0x06)) : active ? nes(0x21) : nes(0x02);
    line(s, pos[from][0], pos[from][1], pos[graph.edgeTo[e]][0], pos[graph.edgeTo[e]][1], color);
  }

  // Neurons on top of the lines.
  graph.nodeLayer.forEach((layer, i) => {
    const [x, y] = pos[i];
    const size = layer === LAYER_INPUT ? 3 : 5;
    s.rect(x - (size >> 1) - 1, y - (size >> 1) - 1, size + 2, size + 2, COLORS.black);
    s.rect(x - (size >> 1), y - (size >> 1), size, size, activationColor(graph.nodeValue[i]));
  });

  // Labels: one per group of inputs, and one per output.
  const inputs = graph.nodeLayer.filter((l) => l === LAYER_INPUT).length;
  const groups: [string, number, number][] = [];
  for (let ray = 0; ray < RAY_COUNT; ray++)
    groups.push([`R${ray + 1}`, ray * RAY_CHANNELS, RAY_CHANNELS]);
  const selfStart = RAY_COUNT * RAY_CHANNELS;
  groups.push(['SELF', selfStart, 4], ['MEM', selfStart + 4, inputs - selfStart - 4]);
  for (const [label, start, n] of groups) {
    const y = Math.round((pos[start][1] + pos[start + n - 1][1]) / 2) - 4;
    s.text(label, 3, y, COLORS.grayLight);
  }
  const firstOutput = graph.nodeLayer.findIndex((l) => l === LAYER_OUTPUT);
  outputLabels().forEach((label, o) => {
    const [x, y] = pos[firstOutput + o];
    s.text(label, x + 6, y - 4, COLORS.white);
  });
}
