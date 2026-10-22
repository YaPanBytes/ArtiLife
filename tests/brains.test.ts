import { describe, expect, it } from 'vitest';
import {
  BRAIN_LAYOUT,
  BRAIN_WEIGHT_COUNT,
  Brain,
  HIDDEN_SIZE,
  INPUT_COUNT,
  OUTPUT_COUNT,
  RECURRENT_WEIGHT_COUNT,
  WEIGHT_LIMIT,
} from '../src/sim/brain';
import { drawBrain, BRAIN_VIEW_HEIGHT } from '../src/render/brain-view';
import { CHART_WIDTH } from '../src/render/charts';
import { BufferSurface } from '../src/render/surface';
import { describeBrain } from '../src/sim/brain-graph';
import { DEFAULT_STRUCTURE, type BrainContext } from '../src/sim/brains';
import { resolveConfig } from '../src/sim/config';
import { Creature } from '../src/sim/creature';
import { upkeep } from '../src/sim/energy';
import {
  TRAIT_COUNT,
  crossover,
  genomeDifference,
  genomeLength,
  isValidGenome,
  mutate,
  randomGenome,
} from '../src/sim/genome';
import {
  InnovationRegistry,
  NEAT_BIAS,
  NEAT_FIRST_HIDDEN,
  NEAT_FIRST_OUTPUT,
  NeatBrain,
  crossoverNeat,
  encodeNeat,
  isValidNeat,
  mutateNeat,
  neatDifference,
  parseNeat,
  randomNeat,
  type NeatGene,
  type NeatMutation,
} from '../src/sim/neat';
import { Rng } from '../src/sim/rng';
import { loadFromJson, saveToJson } from '../src/sim/serialize';
import { Simulation } from '../src/sim/simulation';

const gene = (
  from: number,
  to: number,
  weight: number,
  innovation: number,
  enabled = true,
): NeatGene => ({
  from,
  to,
  weight,
  enabled,
  innovation,
});
const think = (brain: { think(i: Float32Array, o: Float32Array): void }, inputs: Float32Array) => {
  const out = new Float32Array(OUTPUT_COUNT);
  brain.think(inputs, out);
  return out;
};
const inputs = (values: Record<number, number> = {}) => {
  const a = new Float32Array(INPUT_COUNT);
  for (const [i, v] of Object.entries(values)) a[Number(i)] = v;
  return a;
};

describe('recurrent brain', () => {
  it('needs the extra weights, and the plain kind refuses them', () => {
    expect(() => new Brain(new Float32Array(BRAIN_WEIGHT_COUNT), true)).toThrow(/weights/);
    expect(() => new Brain(new Float32Array(RECURRENT_WEIGHT_COUNT), false)).toThrow(/weights/);
    expect(new Brain(new Float32Array(RECURRENT_WEIGHT_COUNT), true).connectionCount).toBe(
      new Brain(new Float32Array(BRAIN_WEIGHT_COUNT)).connectionCount + HIDDEN_SIZE * HIDDEN_SIZE,
    );
  });

  it('remembers: a hidden neuron keeps echoing an input after the input has gone', () => {
    const make = (recurrent: boolean) => {
      const w = new Float32Array(recurrent ? RECURRENT_WEIGHT_COUNT : BRAIN_WEIGHT_COUNT);
      w[BRAIN_LAYOUT.W1] = 2; // hidden 0 reads input 0
      w[BRAIN_LAYOUT.W2] = 1; // output 0 reads hidden 0
      if (recurrent) w[BRAIN_LAYOUT.WREC] = 1.5; // hidden 0 feeds itself
      return new Brain(w, recurrent);
    };
    for (const recurrent of [false, true]) {
      const brain = make(recurrent);
      think(brain, inputs({ 0: 1 }));
      const echo = think(brain, inputs())[0];
      if (recurrent) expect(echo).toBeGreaterThan(0.5);
      else expect(echo).toBe(0);
    }
  });

  it('has genomes of the right length that mutate, cross and compare', () => {
    const rng = new Rng(2);
    const a = randomGenome(rng, 'recurrent');
    const b = randomGenome(rng, 'recurrent');
    expect(a.length).toBe(genomeLength('recurrent'));
    expect(a.length).toBe(TRAIT_COUNT + RECURRENT_WEIGHT_COUNT);
    expect(isValidGenome(a, 'recurrent')).toBe(true);
    expect(isValidGenome(a, 'mlp')).toBe(false);
    const ctx: BrainContext = {
      kind: 'recurrent',
      innovations: new InnovationRegistry(),
      structure: DEFAULT_STRUCTURE,
    };
    expect(mutate(a, rng, 0.2, 5, ctx).length).toBe(a.length);
    expect(crossover(a, b, rng, 'recurrent').length).toBe(a.length);
    expect(genomeDifference(a, a, 'recurrent')).toBe(0);
    expect(genomeDifference(a, b, 'recurrent')).toBeGreaterThan(0);
  });

  it('draws the feedback connections in the brain graph', () => {
    const sim = new Simulation({
      seed: 1,
      brain: { type: 'recurrent' },
      creatures: { initialCount: 5 },
    });
    sim.step();
    const graph = describeBrain(sim.creatures[0]);
    const lateral = Array.from(graph.edgeFrom).filter(
      (from, e) => graph.nodeLayer[from] === 1 && graph.nodeLayer[graph.edgeTo[e]] === 1,
    );
    expect(lateral).toHaveLength(HIDDEN_SIZE * HIDDEN_SIZE);
  });
});

describe('innovation registry', () => {
  it('gives the same number to the same connection and the same split, and different numbers to different ones', () => {
    const r = new InnovationRegistry();
    const a = r.connection(1, 50);
    expect(r.connection(1, 50)).toBe(a);
    expect(r.connection(2, 50)).not.toBe(a);
    expect(r.connection(50, 1)).not.toBe(a);
    const node = r.splitNode(a);
    expect(node).toBeGreaterThanOrEqual(NEAT_FIRST_HIDDEN);
    expect(r.splitNode(a)).toBe(node);
    expect(r.splitNode(r.connection(2, 50))).toBe(node + 1);
  });

  it('survives being saved and restored', () => {
    const r = new InnovationRegistry();
    r.connection(0, 40);
    r.splitNode(r.connection(1, 41));
    const copy = new InnovationRegistry();
    copy.setState(JSON.parse(JSON.stringify(r.getState())));
    expect(copy.connection(0, 40)).toBe(r.connection(0, 40));
    expect(copy.connection(9, 9)).toBe(r.connection(9, 9));
    expect(copy.splitNode(copy.connection(1, 41))).toBe(r.splitNode(r.connection(1, 41)));
  });
});

describe('NEAT genomes', () => {
  it('round-trip through the flat encoding, in innovation order', () => {
    const genes = [gene(3, 40, 0.5, 7), gene(1, 41, -1.25, 2, false), gene(0, 42, 3, 5)];
    const encoded = encodeNeat(genes);
    expect(isValidNeat(encoded)).toBe(true);
    const back = parseNeat(encoded);
    expect(back.map((g) => g.innovation)).toEqual([2, 5, 7]);
    expect(back[0]).toEqual(gene(1, 41, -1.25, 2, false));
    expect(isValidNeat(new Float32Array([2, 1, 2, 3]))).toBe(false);
    expect(isValidNeat(new Float32Array([-1]))).toBe(false);
  });

  it('start as every sensor joined to every output, once, the same way for every creature', () => {
    const registry = new InnovationRegistry();
    const a = parseNeat(randomNeat(new Rng(1), registry));
    const b = parseNeat(randomNeat(new Rng(2), registry));
    expect(a).toHaveLength((INPUT_COUNT + 1) * OUTPUT_COUNT);
    expect(new Set(a.map((g) => `${g.from}>${g.to}`)).size).toBe(a.length);
    expect(a.every((g) => g.enabled && g.to >= NEAT_FIRST_OUTPUT && g.from <= NEAT_BIAS)).toBe(
      true,
    );
    expect(a.map((g) => g.innovation)).toEqual(b.map((g) => g.innovation));
    expect(a.map((g) => g.weight)).not.toEqual(b.map((g) => g.weight));
  });
});

describe('NeatBrain', () => {
  const brainOf = (...genes: NeatGene[]) => new NeatBrain(encodeNeat(genes));

  it('computes a direct connection and the bias', () => {
    const brain = brainOf(
      gene(0, NEAT_FIRST_OUTPUT, 2, 0),
      gene(NEAT_BIAS, NEAT_FIRST_OUTPUT + 1, 0.5, 1),
    );
    const out = think(brain, inputs({ 0: 0.3 }));
    expect(out[0]).toBeCloseTo(Math.tanh(0.6), 6);
    expect(out[1]).toBeCloseTo(Math.tanh(0.5), 6);
    expect(out[2]).toBe(0);
    expect(brain.connectionCount).toBe(2);
  });

  it('passes a signal through a hidden neuron, a tick per step', () => {
    const hidden = NEAT_FIRST_HIDDEN;
    const brain = brainOf(gene(0, hidden, 1.5, 0), gene(hidden, NEAT_FIRST_OUTPUT, 2, 1));
    const x = inputs({ 0: 0.4 });
    expect(think(brain, x)[0]).toBe(0); // the hidden neuron has only just been fed
    expect(think(brain, x)[0]).toBeCloseTo(Math.tanh(2 * Math.tanh(0.6)), 6);
    expect(Array.from(brain.hidden)).toHaveLength(1);
    expect(brain.hiddenIds).toEqual([hidden]);
  });

  it('ignores disabled connections, and lets a neuron feed itself', () => {
    const hidden = NEAT_FIRST_HIDDEN;
    const off = brainOf(gene(0, NEAT_FIRST_OUTPUT, 5, 0, false));
    expect(think(off, inputs({ 0: 1 }))[0]).toBe(0);
    expect(off.connectionCount).toBe(0);
    const loop = brainOf(
      gene(0, hidden, 1, 0),
      gene(hidden, hidden, 1.2, 1),
      gene(hidden, NEAT_FIRST_OUTPUT, 1, 2),
    );
    think(loop, inputs({ 0: 1 }));
    think(loop, inputs());
    const echo = think(loop, inputs())[0];
    expect(echo).toBeGreaterThan(0.3);
  });

  it('learns without changing the weights it was born with', () => {
    const brain = brainOf(gene(0, NEAT_FIRST_OUTPUT, 0.5, 0));
    expect(brain.liveWeights()).toBeNull();
    think(brain, inputs({ 0: 1 }));
    brain.learn(1, 0.2, 0);
    const live = brain.liveWeights()!;
    expect(live[0]).toBeGreaterThan(0.5);
    brain.learn(0, 0.2, 1); // no reward and total forgetting: back to the inherited weight
    expect(brain.liveWeights()![0]).toBeCloseTo(0.5, 6);
  });
});

const mutation = (over: Partial<NeatMutation> = {}): NeatMutation => ({
  weightRate: 0,
  magnitude: 0.1,
  addConnection: 0,
  addNode: 0,
  maxHidden: 24,
  maxConnections: 700,
  ...over,
});

describe('NEAT mutation', () => {
  const start = () => {
    const registry = new InnovationRegistry();
    return { registry, base: randomNeat(new Rng(1), registry) };
  };

  it('changes only weights when asked to, within the limit', () => {
    const { registry, base } = start();
    const child = parseNeat(
      mutateNeat(base, new Rng(2), mutation({ weightRate: 1, magnitude: 50 }), registry),
    );
    const parent = parseNeat(base);
    expect(child).toHaveLength(parent.length);
    expect(child.map((g) => g.innovation)).toEqual(parent.map((g) => g.innovation));
    expect(child.every((g) => Math.abs(g.weight) <= WEIGHT_LIMIT)).toBe(true);
    expect(child.some((g, i) => g.weight !== parent[i].weight)).toBe(true);
  });

  it('splits a connection with a new neuron: the old one off, two new ones on, signal about the same', () => {
    const { registry, base } = start();
    const before = parseNeat(base);
    const after = parseNeat(mutateNeat(base, new Rng(3), mutation({ addNode: 1 }), registry));
    expect(after).toHaveLength(before.length + 2);
    const disabled = after.filter((g) => !g.enabled);
    expect(disabled).toHaveLength(1);
    const node = after.find((g) => g.to >= NEAT_FIRST_HIDDEN)!.to;
    expect(node).toBe(NEAT_FIRST_HIDDEN);
    const into = after.find((g) => g.to === node)!;
    const out = after.find((g) => g.from === node)!;
    expect(into.from).toBe(disabled[0].from);
    expect(out.to).toBe(disabled[0].to);
    expect(into.weight).toBe(1);
    expect(out.weight).toBeCloseTo(disabled[0].weight, 6);
  });

  it('gives the same neuron the same number when two creatures make the same split', () => {
    const registry = new InnovationRegistry();
    const genes = [gene(0, NEAT_FIRST_OUTPUT, 1, registry.connection(0, NEAT_FIRST_OUTPUT))];
    const base = encodeNeat(genes);
    const a = parseNeat(mutateNeat(base, new Rng(1), mutation({ addNode: 1 }), registry));
    const b = parseNeat(mutateNeat(base, new Rng(99), mutation({ addNode: 1 }), registry));
    expect(a.map((g) => g.innovation).sort()).toEqual(b.map((g) => g.innovation).sort());
    expect(a.find((g) => g.to >= NEAT_FIRST_HIDDEN)!.to).toBe(
      b.find((g) => g.to >= NEAT_FIRST_HIDDEN)!.to,
    );
  });

  it('adds a new connection that is never a duplicate and never runs into a sensor', () => {
    const registry = new InnovationRegistry();
    let genome = randomNeat(new Rng(1), registry);
    // Sensors and outputs are all joined, so the first additions must involve new hidden neurons.
    genome = mutateNeat(genome, new Rng(2), mutation({ addNode: 1 }), registry);
    let genes = parseNeat(genome);
    for (let i = 0; i < 40; i++) {
      genome = mutateNeat(genome, new Rng(10 + i), mutation({ addConnection: 1 }), registry);
      genes = parseNeat(genome);
      expect(new Set(genes.map((g) => `${g.from}>${g.to}`)).size).toBe(genes.length);
    }
    expect(genes.every((g) => g.to >= NEAT_FIRST_OUTPUT)).toBe(true);
    expect(genes.length).toBeGreaterThan(300);
  });

  it('stops growing at the limits', () => {
    const registry = new InnovationRegistry();
    let genome = randomNeat(new Rng(1), registry);
    const size = parseNeat(genome).length;
    for (let i = 0; i < 30; i++) {
      genome = mutateNeat(
        genome,
        new Rng(i),
        mutation({ addNode: 1, addConnection: 1, maxConnections: size + 8 }),
        registry,
      );
    }
    expect(parseNeat(genome).length).toBeLessThanOrEqual(size + 8 + 2);
    let capped = randomNeat(new Rng(1), registry);
    for (let i = 0; i < 20; i++)
      capped = mutateNeat(capped, new Rng(i), mutation({ addNode: 1, maxHidden: 3 }), registry);
    const hidden = new Set(
      parseNeat(capped)
        .flatMap((g) => [g.from, g.to])
        .filter((n) => n >= NEAT_FIRST_HIDDEN),
    );
    expect(hidden.size).toBeLessThanOrEqual(3);
  });

  it('is repeatable', () => {
    const { registry, base } = start();
    const m = mutation({ weightRate: 0.3, addNode: 0.5, addConnection: 0.5 });
    const a = mutateNeat(base, new Rng(5), m, new InnovationRegistry());
    const b = mutateNeat(base, new Rng(5), m, new InnovationRegistry());
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(registry).toBeDefined();
  });
});

describe('NEAT crossover and difference', () => {
  const registry = new InnovationRegistry();
  const shared = [
    gene(0, NEAT_FIRST_OUTPUT, 1, registry.connection(0, NEAT_FIRST_OUTPUT)),
    gene(1, NEAT_FIRST_OUTPUT, 2, registry.connection(1, NEAT_FIRST_OUTPUT)),
  ];
  const onlyA = gene(2, NEAT_FIRST_OUTPUT, 3, registry.connection(2, NEAT_FIRST_OUTPUT));
  const onlyB = gene(3, NEAT_FIRST_OUTPUT, 4, registry.connection(3, NEAT_FIRST_OUTPUT));
  const a = encodeNeat([...shared, onlyA]);
  const b = encodeNeat([shared[0], { ...shared[1], weight: -2 }, onlyB]);

  it('makes valid children from the genes of its parents', () => {
    const union = new Set([...parseNeat(a), ...parseNeat(b)].map((g) => g.innovation));
    for (let seed = 0; seed < 30; seed++) {
      const child = crossoverNeat(a, b, new Rng(seed));
      expect(isValidNeat(child)).toBe(true);
      const genes = parseNeat(child);
      expect(genes.every((g) => union.has(g.innovation))).toBe(true);
      expect(new Set(genes.map((g) => g.innovation)).size).toBe(genes.length);
      // Both parents have the first two connections, so the child always does.
      expect(genes.filter((g) => g.innovation === shared[0].innovation)).toHaveLength(1);
    }
  });

  it('takes a shared connection’s weight from either parent', () => {
    const weights = new Set<number>();
    for (let seed = 0; seed < 40; seed++) {
      const g = parseNeat(crossoverNeat(a, b, new Rng(seed))).find(
        (x) => x.innovation === shared[1].innovation,
      )!;
      weights.add(g.weight);
    }
    expect([...weights].sort()).toEqual([-2, 2]);
  });

  it('keeps a connection that is switched off in one parent mostly off', () => {
    const off = encodeNeat([{ ...shared[0], enabled: false }]);
    const on = encodeNeat([shared[0]]);
    let enabled = 0;
    for (let seed = 0; seed < 200; seed++) {
      if (parseNeat(crossoverNeat(off, on, new Rng(seed)))[0].enabled) enabled++;
    }
    expect(enabled).toBeGreaterThan(20);
    expect(enabled).toBeLessThan(90);
  });

  it('measures how far apart two brains are', () => {
    expect(neatDifference(a, a)).toEqual({ sum: 0, count: 3 });
    const d = neatDifference(a, b);
    expect(d.count).toBe(4);
    expect(d.sum).toBeCloseTo((2 - -2) ** 2 + 1 + 1, 6);
    const flipped = neatDifference(b, a);
    expect(flipped).toEqual(d);
    expect(
      genomeDifference(
        new Float32Array([...new Float32Array(TRAIT_COUNT), ...a]),
        new Float32Array([...new Float32Array(TRAIT_COUNT), ...b]),
        'neat',
      ),
    ).toBeGreaterThan(0);
  });
});

describe('creatures with each brain', () => {
  it('only accept genomes that suit their kind', () => {
    const rng = new Rng(1);
    const registry = new InnovationRegistry();
    for (const kind of ['mlp', 'recurrent', 'neat'] as const) {
      const g = randomGenome(rng, kind, registry);
      expect(isValidGenome(g, kind)).toBe(true);
      expect(() => new Creature(1, 5, 5, 0, 50, g, null, 0, kind)).not.toThrow();
    }
    expect(
      () => new Creature(1, 5, 5, 0, 50, randomGenome(rng, 'mlp'), null, 0, 'recurrent'),
    ).toThrow(/genes/);
    expect(
      () => new Creature(1, 5, 5, 0, 50, randomGenome(rng, 'neat', registry), null, 0, 'mlp'),
    ).toThrow(/genes/);
    const broken = randomGenome(rng, 'neat', registry).slice(0, TRAIT_COUNT + 8);
    expect(() => new Creature(1, 5, 5, 0, 50, broken, null, 0, 'neat')).toThrow(/valid neat/);
  });
});

describe('worlds with other brains', () => {
  for (const type of ['recurrent', 'neat']) {
    it(`run with ${type} brains: finite, valid, and alive`, () => {
      const sim = new Simulation({
        seed: 4,
        brain: { type, addConnectionRate: 0.3, addNodeRate: 0.2 },
        creatures: { initialCount: 60 },
      });
      for (let t = 0; t < 1200; t++) sim.step();
      expect(sim.creatures.length).toBeGreaterThan(0);
      expect(sim.stats.births).toBeGreaterThan(0);
      for (const c of sim.creatures) {
        expect(Number.isFinite(c.energy)).toBe(true);
        expect(isValidGenome(c.genome, sim.brainKind)).toBe(true);
        expect(c.outputs.every(Number.isFinite)).toBe(true);
      }
    });
  }

  it('grow new neurons and connections when allowed', () => {
    const sim = new Simulation({
      seed: 4,
      brain: { type: 'neat', addConnectionRate: 0.5, addNodeRate: 0.5 },
      creatures: { initialCount: 60 },
    });
    const start = parseNeat(sim.creatures[0].genome.subarray(TRAIT_COUNT)).length;
    for (let t = 0; t < 1500; t++) sim.step();
    const sizes = sim.creatures.map((c) => parseNeat(c.genome.subarray(TRAIT_COUNT)).length);
    expect(Math.max(...sizes)).toBeGreaterThan(start);
    const hasHidden = sim.creatures.some((c) => (c.brain as NeatBrain).hiddenIds.length > 0);
    expect(hasHidden).toBe(true);
  });

  it('keep species tracking working with the structural distance', () => {
    const sim = new Simulation({
      seed: 2,
      brain: { type: 'neat', addConnectionRate: 0.5, addNodeRate: 0.5 },
      species: { threshold: 0.05 },
      creatures: { initialCount: 60 },
    });
    for (let t = 0; t < 1500; t++) sim.step();
    expect(sim.species.list().length).toBeGreaterThan(1);
    expect(sim.species.list().reduce((n, s) => n + s.count, 0)).toBe(sim.creatures.length);
  });

  it('can be sexual, mixing parents’ connections', () => {
    const sim = new Simulation({
      seed: 6,
      brain: { type: 'neat', addConnectionRate: 0.3, addNodeRate: 0.3 },
      creatures: { sexual: true, mateRange: 3, initialCount: 120, startEnergy: 90 },
    });
    for (let t = 0; t < 600; t++) sim.step();
    expect(sim.stats.births).toBeGreaterThan(0);
    for (const c of sim.creatures) expect(isValidGenome(c.genome, 'neat')).toBe(true);
  });

  it('judges whether two NEAT creatures can mate by their NEAT genomes', () => {
    const sim = new Simulation({
      brain: { type: 'neat' },
      creatures: { sexual: true, mateRange: 3, initialCount: 0 },
      terrain: { waterFraction: 0, rockFraction: 0 },
    });
    const rng = new Rng(4);
    const founder = randomGenome(rng, 'neat', sim.innovations);
    // The same brain missing its first connection: very close kin by NEAT's measure, but
    // every later gene sits one slot earlier, which a fixed-size comparison would call a mess.
    const kin = Float32Array.from([
      ...founder.subarray(0, TRAIT_COUNT),
      ...encodeNeat(parseNeat(founder.subarray(TRAIT_COUNT)).slice(1)),
    ]);
    expect(genomeDifference(founder, kin, 'neat')).toBeLessThan(0.1);
    expect(genomeDifference(founder, kin, 'mlp')).toBeGreaterThan(0.35);
    const parents = [founder, kin].map((genome, i) => {
      const c = new Creature(i, 10 + i * 0.5, 10, 0, 90, genome, null, 0, 'neat');
      c.outputs[2] = 1; // OUT_REPRODUCE
      return c;
    });
    for (const c of parents) c.traits.reproThreshold = 0;
    sim.creatures.push(...parents);
    sim['reproduceSexually']();
    expect(sim.creatures).toHaveLength(3);
  });

  it('save and load exactly, whichever the brain', () => {
    for (const type of ['recurrent', 'neat']) {
      const make = () =>
        new Simulation({
          seed: 7,
          brain: { type, addConnectionRate: 0.3, addNodeRate: 0.2 },
          creatures: { initialCount: 60 },
        });
      const original = make();
      for (let t = 0; t < 300; t++) original.step();
      const loaded = loadFromJson(saveToJson(original));
      expect(saveToJson(loaded)).toBe(saveToJson(original));
      for (let t = 0; t < 300; t++) {
        original.step();
        loaded.step();
      }
      expect(saveToJson(loaded)).toBe(saveToJson(original));
    }
  });

  it('charge for the connections a brain has', () => {
    const config = resolveConfig({ brain: { connectionCost: 0.001 } });
    const sim = new Simulation({ ...config, creatures: { initialCount: 2 } });
    const c = sim.creatures[0];
    const free = upkeep(c, resolveConfig());
    expect(upkeep(c, config) - free).toBeCloseTo(0.001 * c.brain.connectionCount, 9);
    expect(c.brain.connectionCount).toBeGreaterThan(300);
  });

  it('are drawn as graphs with sensible edges', () => {
    for (const type of ['mlp', 'recurrent', 'neat']) {
      const sim = new Simulation({
        seed: 3,
        brain: { type, addNodeRate: 1, addConnectionRate: 1 },
        creatures: { initialCount: 30 },
      });
      for (let t = 0; t < 400; t++) sim.step();
      const c = sim.creatures[0];
      const graph = describeBrain(c);
      expect(graph.edgeWeight.length).toBeGreaterThan(0);
      for (let e = 0; e < graph.edgeWeight.length; e++) {
        expect(graph.edgeFrom[e]).toBeLessThan(graph.nodeLayer.length);
        expect(graph.edgeTo[e]).toBeLessThan(graph.nodeLayer.length);
        expect(graph.nodeLayer[graph.edgeTo[e]]).toBeGreaterThan(0); // nothing runs into a sensor
      }
      const surface = new BufferSurface(CHART_WIDTH, BRAIN_VIEW_HEIGHT);
      expect(() => drawBrain(surface, graph)).not.toThrow();
      expect(surface.texts.map((t) => t.str)).toContain('TURN');
    }
  });
});

describe('brain config', () => {
  it('is validated', () => {
    expect(() => resolveConfig({ brain: { type: 'quantum' } })).toThrow(/brain.type/);
    expect(() => resolveConfig({ brain: { addNodeRate: 2 } })).toThrow(/addNodeRate/);
    expect(() => resolveConfig({ brain: { connectionCost: -1 } })).toThrow(/connectionCost/);
    expect(() => resolveConfig({ learning: { rate: -1 } })).toThrow(/learning.rate/);
    expect(() => resolveConfig({ learning: { forgetting: 3 } })).toThrow(/forgetting/);
    expect(resolveConfig({ brain: { type: 'neat' } }).brain.type).toBe('neat');
  });
});
