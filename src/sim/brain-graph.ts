import { HIDDEN_SIZE, INPUT_COUNT, MEMORY_SIZE, OUTPUT_COUNT } from './brain';
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
  const nodes = INPUT_COUNT + HIDDEN_SIZE + OUTPUT_COUNT;
  const nodeLayer = new Uint8Array(nodes);
  const nodeValue = new Float32Array(nodes);
  for (let i = 0; i < INPUT_COUNT; i++) {
    nodeLayer[i] = LAYER_INPUT;
    nodeValue[i] = c.inputs[i];
  }
  for (let h = 0; h < HIDDEN_SIZE; h++) {
    nodeLayer[INPUT_COUNT + h] = LAYER_HIDDEN;
    nodeValue[INPUT_COUNT + h] = c.brain.hidden[h];
  }
  for (let o = 0; o < OUTPUT_COUNT; o++) {
    nodeLayer[INPUT_COUNT + HIDDEN_SIZE + o] = LAYER_OUTPUT;
    nodeValue[INPUT_COUNT + HIDDEN_SIZE + o] = c.outputs[o];
  }

  const { weights } = c.brain;
  const w1 = 0;
  const w2 = HIDDEN_SIZE * INPUT_COUNT + HIDDEN_SIZE;
  const edges = HIDDEN_SIZE * INPUT_COUNT + OUTPUT_COUNT * HIDDEN_SIZE;
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
  return { nodeLayer, nodeValue, edgeFrom, edgeTo, edgeWeight };
}
