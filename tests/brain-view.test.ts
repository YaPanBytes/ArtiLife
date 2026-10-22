import { describe, expect, it } from 'vitest';
import {
  BRAIN_VIEW_HEIGHT,
  activationColor,
  drawBrain,
  layoutBrain,
} from '../src/render/brain-view';
import { CHART_WIDTH } from '../src/render/charts';
import { COLORS, nes } from '../src/render/palette';
import { BufferSurface } from '../src/render/surface';
import { LAYER_HIDDEN, LAYER_INPUT, LAYER_OUTPUT, describeBrain } from '../src/sim/brain-graph';
import { Simulation } from '../src/sim/simulation';

const sim = new Simulation({ seed: 4, creatures: { initialCount: 8 } });
sim.step();
const graph = describeBrain(sim.creatures[0]);

describe('layoutBrain', () => {
  const pos = layoutBrain(graph, CHART_WIDTH, BRAIN_VIEW_HEIGHT);

  it('places every neuron inside the picture, in three columns left to right', () => {
    expect(pos).toHaveLength(graph.nodeLayer.length);
    for (const [x, y] of pos) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(CHART_WIDTH);
      expect(y).toBeGreaterThan(10);
      expect(y).toBeLessThan(BRAIN_VIEW_HEIGHT);
    }
    const colX = (layer: number) => pos[graph.nodeLayer.indexOf(layer)][0];
    expect(colX(LAYER_INPUT)).toBeLessThan(colX(LAYER_HIDDEN));
    expect(colX(LAYER_HIDDEN)).toBeLessThan(colX(LAYER_OUTPUT));
  });

  it('gives no two neurons in a layer the same spot, ordered top to bottom', () => {
    for (const layer of [LAYER_INPUT, LAYER_HIDDEN, LAYER_OUTPUT]) {
      const ys = pos.filter((_, i) => graph.nodeLayer[i] === layer).map((p) => p[1]);
      expect(new Set(ys).size).toBe(ys.length);
      expect(ys).toEqual([...ys].sort((a, b) => a - b));
    }
  });
});

describe('activationColor', () => {
  it('is dark when quiet, brighter when stronger, and blue when negative', () => {
    expect(activationColor(0)).toEqual(COLORS.grayDark);
    expect(activationColor(0.95)).toEqual(nes(0x28));
    expect(activationColor(-0.95)).toEqual(nes(0x21));
    expect(activationColor(0.5)).not.toEqual(activationColor(0.2));
    expect(activationColor(-0.5)).not.toEqual(activationColor(0.5));
  });
});

describe('drawBrain', () => {
  it('draws a title, labels for the actions, and both signs of connection', () => {
    const s = new BufferSurface(CHART_WIDTH, BRAIN_VIEW_HEIGHT);
    drawBrain(s, graph);
    const texts = s.texts.map((t) => t.str);
    expect(texts[0]).toBe('BRAIN');
    for (const label of ['TURN', 'GO', 'MATE', 'BITE', 'R1', 'R5', 'SELF', 'MEM']) {
      expect(texts).toContain(label);
    }
    const warm = s.count(nes(0x06)) + s.count(nes(0x16));
    const cool = s.count(nes(0x02)) + s.count(nes(0x21));
    expect(warm).toBeGreaterThan(20);
    expect(cool).toBeGreaterThan(20);
  });

  it('lights up connections that carry signal and no more than the strongest few', () => {
    const quiet = { ...graph, nodeValue: new Float32Array(graph.nodeValue.length) };
    const loud = { ...graph, nodeValue: new Float32Array(graph.nodeValue.length).fill(1) };
    const a = new BufferSurface(CHART_WIDTH, BRAIN_VIEW_HEIGHT);
    const b = new BufferSurface(CHART_WIDTH, BRAIN_VIEW_HEIGHT);
    drawBrain(a, quiet);
    drawBrain(b, loud);
    expect(b.count(nes(0x16)) + b.count(nes(0x21))).toBeGreaterThan(
      a.count(nes(0x16)) + a.count(nes(0x21)),
    );
  });
});
