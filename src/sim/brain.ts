import type { Rng } from './rng';
import { SENSE_INPUT_COUNT } from './senses';

/** Neurons that carry state from one tick to the next. */
export const MEMORY_SIZE = 2;
export const HIDDEN_SIZE = 10;

export const INPUT_COUNT = SENSE_INPUT_COUNT + MEMORY_SIZE;

/** Output indices. The rest of the outputs are the new memory values. */
export const OUT_TURN = 0;
export const OUT_THRUST = 1;
/** The creature tries to reproduce while this is above 0. */
export const OUT_REPRODUCE = 2;
/** The creature tries to bite whatever is in front of it while this is above 0. */
export const OUT_BITE = 3;
/** How loudly the creature calls, from -1 to 1. Other creatures can see it. */
export const OUT_SIGNAL = 4;
export const OUT_MEMORY = 5;
export const OUTPUT_COUNT = OUT_MEMORY + MEMORY_SIZE;

// Weight layout in the genome: W1 (hidden x inputs), b1, W2 (outputs x hidden), b2.
const W1 = 0;
const B1 = W1 + HIDDEN_SIZE * INPUT_COUNT;
const W2 = B1 + HIDDEN_SIZE;
const B2 = W2 + OUTPUT_COUNT * HIDDEN_SIZE;
export const BRAIN_WEIGHT_COUNT = B2 + OUTPUT_COUNT;

/** Fill `weights` with small random values scaled by each layer's fan-in. */
export function initBrainWeights(rng: Rng, weights: Float32Array): void {
  const layer = (start: number, count: number, fanIn: number) => {
    for (let i = start; i < start + count; i++) weights[i] = rng.gaussian(0, 1 / Math.sqrt(fanIn));
  };
  layer(W1, HIDDEN_SIZE * INPUT_COUNT, INPUT_COUNT);
  layer(B1, HIDDEN_SIZE, INPUT_COUNT);
  layer(W2, OUTPUT_COUNT * HIDDEN_SIZE, HIDDEN_SIZE);
  layer(B2, OUTPUT_COUNT, HIDDEN_SIZE);
}

/**
 * A small feed-forward network (inputs -> tanh hidden -> tanh outputs) that
 * reads its weights straight from a genome view.
 */
export class Brain {
  /** Hidden neuron values from the last call to `think`. */
  readonly hidden = new Float32Array(HIDDEN_SIZE);

  constructor(readonly weights: Float32Array) {
    if (weights.length !== BRAIN_WEIGHT_COUNT) {
      throw new RangeError(`brain needs ${BRAIN_WEIGHT_COUNT} weights, got ${weights.length}`);
    }
  }

  think(inputs: Float32Array, outputs: Float32Array): void {
    const { weights, hidden } = this;
    for (let h = 0; h < HIDDEN_SIZE; h++) {
      let sum = weights[B1 + h];
      const row = W1 + h * INPUT_COUNT;
      for (let i = 0; i < INPUT_COUNT; i++) sum += weights[row + i] * inputs[i];
      hidden[h] = Math.tanh(sum);
    }
    for (let o = 0; o < OUTPUT_COUNT; o++) {
      let sum = weights[B2 + o];
      const row = W2 + o * HIDDEN_SIZE;
      for (let h = 0; h < HIDDEN_SIZE; h++) sum += weights[row + h] * hidden[h];
      outputs[o] = Math.tanh(sum);
    }
  }
}

/** Offsets into the brain weights, for tests and tooling. */
export const BRAIN_LAYOUT = { W1, B1, W2, B2 } as const;
