import type { BrainLike } from './brains';
import { INPUT_COUNT, LEARNED_OUTPUTS, OUTPUT_COUNT, WEIGHT_LIMIT } from './brain';
import { clamp } from './math';
import type { Rng } from './rng';

/**
 * A brain whose structure evolves, in the style of NEAT. The genome lists
 * connections between neurons; mutation can add a connection or split one with a
 * new neuron, so brains start simple and can grow.
 *
 * Neuron numbering: inputs first, then one constant "bias" neuron, then the
 * outputs, then hidden neurons. Hidden neurons get their number from the
 * connection that was split to make them, so the same change in two creatures
 * gets the same number and their genomes can be compared and crossed.
 */
export const NEAT_BIAS = INPUT_COUNT;
export const NEAT_FIRST_OUTPUT = INPUT_COUNT + 1;
export const NEAT_FIRST_HIDDEN = NEAT_FIRST_OUTPUT + OUTPUT_COUNT;

/** Floats per connection in the encoded genome: from, to, weight, enabled, innovation. */
const FIELDS = 5;

export interface NeatGene {
  from: number;
  to: number;
  weight: number;
  enabled: boolean;
  /** Identifies this connection across all genomes. */
  innovation: number;
}

export interface InnovationState {
  connections: [string, number][];
  splits: [number, number][];
  nextInnovation: number;
  nextNode: number;
}

/**
 * Hands out numbers for new connections and neurons, the same number for the
 * same change wherever it happens, so genomes can be lined up gene by gene.
 */
export class InnovationRegistry {
  private connections = new Map<string, number>();
  private splits = new Map<number, number>();
  private nextInnovation = 0;
  private nextNode = NEAT_FIRST_HIDDEN;

  /** The innovation number of the connection from `from` to `to`. */
  connection(from: number, to: number): number {
    const key = `${from}>${to}`;
    let id = this.connections.get(key);
    if (id === undefined) {
      id = this.nextInnovation++;
      this.connections.set(key, id);
    }
    return id;
  }

  /** The neuron made by splitting the connection with this innovation number. */
  splitNode(innovation: number): number {
    let node = this.splits.get(innovation);
    if (node === undefined) {
      node = this.nextNode++;
      this.splits.set(innovation, node);
    }
    return node;
  }

  getState(): InnovationState {
    return {
      connections: [...this.connections],
      splits: [...this.splits],
      nextInnovation: this.nextInnovation,
      nextNode: this.nextNode,
    };
  }

  setState(state: InnovationState): void {
    this.connections = new Map(state.connections);
    this.splits = new Map(state.splits);
    this.nextInnovation = state.nextInnovation;
    this.nextNode = state.nextNode;
  }
}

/** Read the connections out of an encoded brain. */
export function parseNeat(payload: Float32Array): NeatGene[] {
  const count = payload[0];
  const genes: NeatGene[] = [];
  for (let k = 0; k < count; k++) {
    const o = 1 + k * FIELDS;
    genes.push({
      from: payload[o],
      to: payload[o + 1],
      weight: payload[o + 2],
      enabled: payload[o + 3] > 0.5,
      innovation: payload[o + 4],
    });
  }
  return genes;
}

/** Write connections into the flat form genomes use, in innovation order. */
export function encodeNeat(genes: readonly NeatGene[]): Float32Array {
  const sorted = [...genes].sort((a, b) => a.innovation - b.innovation);
  const out = new Float32Array(1 + sorted.length * FIELDS);
  out[0] = sorted.length;
  sorted.forEach((g, k) => {
    const o = 1 + k * FIELDS;
    out[o] = g.from;
    out[o + 1] = g.to;
    out[o + 2] = g.weight;
    out[o + 3] = g.enabled ? 1 : 0;
    out[o + 4] = g.innovation;
  });
  return out;
}

/** Is this a well-formed encoded brain? */
export function isValidNeat(payload: Float32Array): boolean {
  const count = payload[0];
  return Number.isInteger(count) && count >= 0 && payload.length === 1 + count * FIELDS;
}

/** A starting brain: every sensor connected straight to every output, with small random weights. */
export function randomNeat(rng: Rng, registry: InnovationRegistry): Float32Array {
  const genes: NeatGene[] = [];
  const scale = 1 / Math.sqrt(INPUT_COUNT);
  for (let o = 0; o < OUTPUT_COUNT; o++) {
    const to = NEAT_FIRST_OUTPUT + o;
    for (let from = 0; from <= NEAT_BIAS; from++) {
      genes.push({
        from,
        to,
        weight: rng.gaussian(0, scale),
        enabled: true,
        innovation: registry.connection(from, to),
      });
    }
  }
  return encodeNeat(genes);
}

export interface NeatMutation {
  /** Chance each connection's weight changes, and the size of the change. */
  weightRate: number;
  magnitude: number;
  /** Chance per birth of each structural change. */
  addConnection: number;
  addNode: number;
  maxHidden: number;
  maxConnections: number;
}

/** The hidden neurons a set of connections uses. */
function hiddenNodes(genes: readonly NeatGene[]): number[] {
  const seen = new Set<number>();
  for (const g of genes) {
    if (g.from >= NEAT_FIRST_HIDDEN) seen.add(g.from);
    if (g.to >= NEAT_FIRST_HIDDEN) seen.add(g.to);
  }
  return [...seen].sort((a, b) => a - b);
}

/** A mutated copy: some weights nudged, and occasionally a new connection or a new neuron. */
export function mutateNeat(
  payload: Float32Array,
  rng: Rng,
  m: NeatMutation,
  registry: InnovationRegistry,
): Float32Array {
  const genes = parseNeat(payload);
  for (const g of genes) {
    if (rng.next() < m.weightRate) {
      g.weight = clamp(g.weight + rng.gaussian(0, m.magnitude), -WEIGHT_LIMIT, WEIGHT_LIMIT);
    }
  }

  if (genes.length < m.maxConnections && rng.next() < m.addConnection)
    addConnection(genes, rng, registry);

  if (rng.next() < m.addNode && genes.length < m.maxConnections) {
    if (hiddenNodes(genes).length < m.maxHidden) addNode(genes, rng, registry);
  }
  return encodeNeat(genes);
}

/** Join two neurons that aren't joined yet, or switch a disabled connection back on. */
function addConnection(genes: NeatGene[], rng: Rng, registry: InnovationRegistry): void {
  const hidden = hiddenNodes(genes);
  const sources = [
    ...Array.from({ length: NEAT_FIRST_HIDDEN }, (_, i) => i), // inputs, bias, outputs
    ...hidden,
  ];
  const targets = [
    ...Array.from({ length: OUTPUT_COUNT }, (_, o) => NEAT_FIRST_OUTPUT + o),
    ...hidden,
  ];
  for (let attempt = 0; attempt < 20; attempt++) {
    const from = sources[rng.int(sources.length)];
    const to = targets[rng.int(targets.length)];
    const existing = genes.find((g) => g.from === from && g.to === to);
    if (existing) {
      if (!existing.enabled) {
        existing.enabled = true;
        return;
      }
      continue;
    }
    genes.push({
      from,
      to,
      weight: rng.gaussian(0, 0.5),
      enabled: true,
      innovation: registry.connection(from, to),
    });
    return;
  }
}

/** Split a connection: switch it off and route through a new neuron, keeping the signal about the same. */
function addNode(genes: NeatGene[], rng: Rng, registry: InnovationRegistry): void {
  const enabled = genes.filter((g) => g.enabled);
  if (enabled.length === 0) return;
  const old = enabled[rng.int(enabled.length)];
  const node = registry.splitNode(old.innovation);
  // The same split made earlier in this lineage: nothing new to add.
  if (genes.some((g) => g.from === node || g.to === node)) return;
  old.enabled = false;
  genes.push({
    from: old.from,
    to: node,
    weight: 1,
    enabled: true,
    innovation: registry.connection(old.from, node),
  });
  genes.push({
    from: node,
    to: old.to,
    weight: old.weight,
    enabled: true,
    innovation: registry.connection(node, old.to),
  });
}

/**
 * Mix two brains. Connections both parents have are taken from one or the other;
 * connections only one has are kept half the time. A connection switched off in
 * either parent usually stays off.
 */
export function crossoverNeat(a: Float32Array, b: Float32Array, rng: Rng): Float32Array {
  const bByInnovation = new Map(parseNeat(b).map((g) => [g.innovation, g]));
  const aGenes = parseNeat(a);
  const aInnovations = new Set(aGenes.map((g) => g.innovation));
  const child: NeatGene[] = [];
  for (const g of aGenes) {
    const other = bByInnovation.get(g.innovation);
    if (other) {
      const pick = rng.next() < 0.5 ? g : other;
      const enabled = g.enabled && other.enabled ? true : rng.next() < 0.25;
      child.push({ ...pick, enabled });
    } else if (rng.next() < 0.5) child.push({ ...g });
  }
  for (const g of bByInnovation.values()) {
    if (!aInnovations.has(g.innovation) && rng.next() < 0.5) child.push({ ...g });
  }
  return encodeNeat(child);
}

/**
 * How different two brains are, as a sum of squares and a count, so it can be
 * averaged like the fixed-size brains' weights. Connections both have contribute
 * their squared weight difference; a connection only one has counts as a
 * difference of 1.
 */
export function neatDifference(a: Float32Array, b: Float32Array): { sum: number; count: number } {
  const bByInnovation = new Map(parseNeat(b).map((g) => [g.innovation, g]));
  const aGenes = parseNeat(a);
  let sum = 0;
  let count = 0;
  let matched = 0;
  for (const g of aGenes) {
    const other = bByInnovation.get(g.innovation);
    count++;
    if (other) {
      const dw = (g.enabled ? g.weight : 0) - (other.enabled ? other.weight : 0);
      sum += dw * dw;
      matched++;
    } else sum += 1;
  }
  const onlyInB = bByInnovation.size - matched;
  return { sum: sum + onlyInB, count: count + onlyInB };
}

/** A brain built from an encoded NEAT genome. All connections update at once, so signals take a tick per step. */
export class NeatBrain implements BrainLike {
  /** Values of every neuron: inputs, bias, outputs, then hidden. */
  readonly values: Float32Array;
  /** The hidden neurons' values (a view into `values`). */
  readonly hidden: Float32Array;
  readonly connectionCount: number;
  /** Neuron numbers of the hidden neurons, in the order they are stored. */
  readonly hiddenIds: number[];
  private readonly sources: Int32Array;
  private readonly targets: Int32Array;
  private readonly base: Float32Array;
  private live: Float32Array | null = null;
  private weights: Float32Array;
  private readonly sums: Float32Array;
  /** Which connections learn: those running into an action output. */
  private readonly learnable: Uint8Array;
  /** The enabled connections as they were, for drawing. */
  readonly genes: NeatGene[];

  constructor(payload: Float32Array) {
    const genes = parseNeat(payload).filter((g) => g.enabled && g.to >= NEAT_FIRST_OUTPUT);
    this.genes = genes;
    this.hiddenIds = hiddenNodes(genes);
    const slot = new Map<number, number>();
    for (let id = 0; id < NEAT_FIRST_HIDDEN; id++) slot.set(id, id);
    this.hiddenIds.forEach((id, k) => slot.set(id, NEAT_FIRST_HIDDEN + k));
    this.values = new Float32Array(NEAT_FIRST_HIDDEN + this.hiddenIds.length);
    this.hidden = this.values.subarray(NEAT_FIRST_HIDDEN);
    this.sums = new Float32Array(this.values.length);
    this.connectionCount = genes.length;
    this.sources = Int32Array.from(genes, (g) => slot.get(g.from)!);
    this.targets = Int32Array.from(genes, (g) => slot.get(g.to)!);
    this.base = Float32Array.from(genes, (g) => g.weight);
    this.learnable = Uint8Array.from(genes, (g) =>
      LEARNED_OUTPUTS.includes(g.to - NEAT_FIRST_OUTPUT) ? 1 : 0,
    );
    this.weights = this.base;
    this.values[NEAT_BIAS] = 1;
  }

  think(inputs: Float32Array, outputs: Float32Array): void {
    const { values, sums, sources, targets, weights } = this;
    for (let i = 0; i < INPUT_COUNT; i++) values[i] = inputs[i];
    sums.fill(0);
    for (let k = 0; k < weights.length; k++) sums[targets[k]] += weights[k] * values[sources[k]];
    for (let n = NEAT_FIRST_OUTPUT; n < values.length; n++) values[n] = Math.tanh(sums[n]);
    for (let o = 0; o < OUTPUT_COUNT; o++) outputs[o] = values[NEAT_FIRST_OUTPUT + o];
  }

  learn(reward: number, rate: number, forgetting: number): void {
    if (!this.live) {
      this.live = Float32Array.from(this.base);
      this.weights = this.live;
    }
    const { live, base, values, sources, targets } = this;
    const g = rate * reward;
    const limit = WEIGHT_LIMIT * 1.5;
    for (let k = 0; k < live.length; k++) {
      let w = live[k];
      if (g !== 0 && this.learnable[k]) w += g * values[sources[k]] * values[targets[k]];
      w += forgetting * (base[k] - w);
      live[k] = clamp(w, -limit, limit);
    }
  }

  /** Every neuron's value: connections take a tick, so these carry over. */
  getState(): Float32Array {
    return Float32Array.from(this.values);
  }

  setState(state: Float32Array): void {
    if (state.length === this.values.length) this.values.set(state);
  }

  liveWeights(): Float32Array | null {
    return this.live;
  }

  setLiveWeights(weights: Float32Array): void {
    if (weights.length !== this.base.length) return;
    this.live = Float32Array.from(weights);
    this.weights = this.live;
  }
}
