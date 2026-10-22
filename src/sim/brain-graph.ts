import { BRAIN_LAYOUT, Brain, HIDDEN_SIZE, INPUT_COUNT, MEMORY_SIZE, OUTPUT_COUNT } from './brain';
import { NEAT_BIAS, NEAT_FIRST_HIDDEN, NEAT_FIRST_OUTPUT, type NeatBrain } from './neat';
import type { Creature } from './creature';
import { RAY_CHANNELS, RAY_COUNT } from './senses';

export const LAYER_INPUT = 0;
export const LAYER_HIDDEN = 1;
export const LAYER_OUTPUT = 2;

/**
 * A creature's brain as a plain graph, for drawing. Nodes are numbered inputs
 * first, then hidden, then outputs. `value` is each neuron's current activation.
 */
export interface BrainGraph {
  nodeLayer: Uint8Array;
  nodeValue: Float32Array;
  edgeFrom: Uint16Array;
  edgeTo: Uint16Array;
  edgeWeight: Float32Array;
}

const RAY_LABELS = ['FOOD', 'WALL', 'CRTR', 'SIZE', 'DIET', 'CALL'];
const SELF_LABELS = ['NRG', 'SPD', 'FOOD', 'HURT'];

/** Short names for the brain's inputs, in order. */
export function inputLabels(): string[] {
  const labels: string[] = [];
  for (let ray = 1; ray <= RAY_COUNT; ray++) {
    for (let ch = 0; ch < RAY_CHANNELS; ch++) labels.push(`R${ray} ${RAY_LABELS[ch]}`);
  }
  for (const l of SELF_LABELS) labels.push(`SELF ${l}`);
  for (let m = 1; m <= MEMORY_SIZE; m++) labels.push(`MEM ${m}`);
  return labels;
}

/** Short names for the brain's outputs, in order. */
export function outputLabels(): string[] {
  const labels = ['TURN', 'GO', 'MATE', 'BITE', 'CALL'];
  for (let m = 1; m <= MEMORY_SIZE; m++) labels.push(`MEM ${m}`);
  return labels;
}

/** Describe a creature's brain, with the activations from its latest tick. */
export function describeBrain(c: Creature): BrainGraph {
  return c.brainKind === 'neat'
    ? describeNeat(c, c.brain as NeatBrain)
    : describeLayered(c, c.brain as Brain);
}

/** The feed-forward kinds: every sensor to every hidden neuron to every output, plus hidden-to-hidden for recurrent. */
function describeLayered(c: Creature, brain: Brain): BrainGraph {
  const nodes = INPUT_COUNT + HIDDEN_SIZE + OUTPUT_COUNT;
  const nodeLayer = new Uint8Array(nodes);
  const nodeValue = new Float32Array(nodes);
  for (let i = 0; i < INPUT_COUNT; i++) {
    nodeLayer[i] = LAYER_INPUT;
    nodeValue[i] = c.inputs[i];
  }
  for (let h = 0; h < HIDDEN_SIZE; h++) {
    nodeLayer[INPUT_COUNT + h] = LAYER_HIDDEN;
    nodeValue[INPUT_COUNT + h] = brain.hidden[h];
  }
  for (let o = 0; o < OUTPUT_COUNT; o++) {
    nodeLayer[INPUT_COUNT + HIDDEN_SIZE + o] = LAYER_OUTPUT;
    nodeValue[INPUT_COUNT + HIDDEN_SIZE + o] = c.outputs[o];
  }

  // Show the weights in use, which differ from the inherited ones once a brain has learned.
  const weights = brain.liveWeights() ?? brain.weights;
  const w1 = BRAIN_LAYOUT.W1;
  const w2 = BRAIN_LAYOUT.W2;
  const feedback = brain.recurrent ? HIDDEN_SIZE * HIDDEN_SIZE : 0;
  const edges = HIDDEN_SIZE * INPUT_COUNT + OUTPUT_COUNT * HIDDEN_SIZE + feedback;
  const edgeFrom = new Uint16Array(edges);
  const edgeTo = new Uint16Array(edges);
  const edgeWeight = new Float32Array(edges);
  let e = 0;
  for (let h = 0; h < HIDDEN_SIZE; h++) {
    for (let i = 0; i < INPUT_COUNT; i++, e++) {
      edgeFrom[e] = i;
      edgeTo[e] = INPUT_COUNT + h;
      edgeWeight[e] = weights[w1 + h * INPUT_COUNT + i];
    }
  }
  for (let o = 0; o < OUTPUT_COUNT; o++) {
    for (let h = 0; h < HIDDEN_SIZE; h++, e++) {
      edgeFrom[e] = INPUT_COUNT + h;
      edgeTo[e] = INPUT_COUNT + HIDDEN_SIZE + o;
      edgeWeight[e] = weights[w2 + o * HIDDEN_SIZE + h];
    }
  }
  for (let h = 0; h < feedback / HIDDEN_SIZE; h++) {
    for (let j = 0; j < HIDDEN_SIZE; j++, e++) {
      edgeFrom[e] = INPUT_COUNT + j;
      edgeTo[e] = INPUT_COUNT + h;
      edgeWeight[e] = weights[BRAIN_LAYOUT.WREC + h * HIDDEN_SIZE + j];
    }
  }
  return { nodeLayer, nodeValue, edgeFrom, edgeTo, edgeWeight };
}

/** A NEAT brain: whatever neurons and connections evolution has built. The constant bias neuron is left out. */
function describeNeat(c: Creature, brain: NeatBrain): BrainGraph {
  const hidden = brain.hiddenIds.length;
  const nodes = INPUT_COUNT + hidden + OUTPUT_COUNT;
  const nodeLayer = new Uint8Array(nodes);
  const nodeValue = new Float32Array(nodes);
  for (let i = 0; i < INPUT_COUNT; i++) {
    nodeLayer[i] = LAYER_INPUT;
    nodeValue[i] = c.inputs[i];
  }
  for (let h = 0; h < hidden; h++) {
    nodeLayer[INPUT_COUNT + h] = LAYER_HIDDEN;
    nodeValue[INPUT_COUNT + h] = brain.hidden[h];
  }
  for (let o = 0; o < OUTPUT_COUNT; o++) {
    nodeLayer[INPUT_COUNT + hidden + o] = LAYER_OUTPUT;
    nodeValue[INPUT_COUNT + hidden + o] = c.outputs[o];
  }
  const hiddenSlot = new Map(brain.hiddenIds.map((id, k) => [id, INPUT_COUNT + k]));
  const slot = (id: number): number =>
    id < INPUT_COUNT
      ? id
      : id >= NEAT_FIRST_HIDDEN
        ? hiddenSlot.get(id)!
        : INPUT_COUNT + hidden + (id - NEAT_FIRST_OUTPUT);
  const weights = brain.liveWeights();
  const shown = brain.genes
    .map((g, k) => ({ g, weight: weights ? weights[k] : g.weight }))
    .filter(({ g }) => g.from !== NEAT_BIAS);
  return {
    nodeLayer,
    nodeValue,
    edgeFrom: Uint16Array.from(shown, ({ g }) => slot(g.from)),
    edgeTo: Uint16Array.from(shown, ({ g }) => slot(g.to)),
    edgeWeight: Float32Array.from(shown, ({ weight }) => weight),
  };
}
