import { describe, expect, it } from 'vitest';
import { HIDDEN_SIZE, INPUT_COUNT, OUTPUT_COUNT } from '../src/sim/brain';
import {
  LAYER_HIDDEN,
  LAYER_INPUT,
  LAYER_OUTPUT,
  describeBrain,
  inputLabels,
  outputLabels,
} from '../src/sim/brain-graph';
import { TRAIT_COUNT } from '../src/sim/genome';
import { Simulation } from '../src/sim/simulation';

describe('describeBrain', () => {
  const sim = new Simulation({ seed: 3, creatures: { initialCount: 10 } });
  sim.step();
  const c = sim.creatures[0];
  const g = describeBrain(c);

  it('has a node for every neuron and an edge for every connection, ordered input, hidden, output', () => {
    expect(g.nodeLayer.length).toBe(INPUT_COUNT + HIDDEN_SIZE + OUTPUT_COUNT);
    expect(g.edgeWeight.length).toBe(INPUT_COUNT * HIDDEN_SIZE + HIDDEN_SIZE * OUTPUT_COUNT);
    expect(Array.from(g.nodeLayer.subarray(0, INPUT_COUNT)).every((l) => l === LAYER_INPUT)).toBe(
      true,
    );
    expect(g.nodeLayer[INPUT_COUNT]).toBe(LAYER_HIDDEN);
    expect(g.nodeLayer[g.nodeLayer.length - 1]).toBe(LAYER_OUTPUT);
  });

  it('carries the live activations', () => {
    for (let i = 0; i < INPUT_COUNT; i++) expect(g.nodeValue[i]).toBe(c.inputs[i]);
    for (let h = 0; h < HIDDEN_SIZE; h++)
      expect(g.nodeValue[INPUT_COUNT + h]).toBe(c.brain.hidden[h]);
    for (let o = 0; o < OUTPUT_COUNT; o++) {
      expect(g.nodeValue[INPUT_COUNT + HIDDEN_SIZE + o]).toBe(c.outputs[o]);
    }
  });

  it('only joins neurons in adjacent layers, and uses the genome’s weights', () => {
    const weights = new Set(Array.from(c.genome.subarray(TRAIT_COUNT)));
    for (let e = 0; e < g.edgeWeight.length; e++) {
      const from = g.nodeLayer[g.edgeFrom[e]];
      const to = g.nodeLayer[g.edgeTo[e]];
      expect(to).toBe(from + 1);
      expect(weights.has(g.edgeWeight[e])).toBe(true);
    }
  });

  it('connects every input to every hidden neuron exactly once', () => {
    const seen = new Set<number>();
    for (let e = 0; e < INPUT_COUNT * HIDDEN_SIZE; e++)
      seen.add(g.edgeFrom[e] * 1000 + g.edgeTo[e]);
    expect(seen.size).toBe(INPUT_COUNT * HIDDEN_SIZE);
  });

  it('has a label for every input and output', () => {
    expect(inputLabels().length).toBe(INPUT_COUNT);
    expect(outputLabels().length).toBe(OUTPUT_COUNT);
    expect(new Set(inputLabels()).size).toBe(INPUT_COUNT);
    expect(outputLabels().slice(0, 4)).toEqual(['TURN', 'GO', 'MATE', 'BITE']);
  });
});
