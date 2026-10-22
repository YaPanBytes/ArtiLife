import type { BrainLike } from './brains';
import { clamp } from './math';
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
/** Recurrent brains add one more block: each hidden neuron's weight from each hidden neuron's last value. */
const WREC = BRAIN_WEIGHT_COUNT;
export const RECURRENT_WEIGHT_COUNT = BRAIN_WEIGHT_COUNT + HIDDEN_SIZE * HIDDEN_SIZE;

/** The outputs whose connections can learn: the ones a food reward is informative about. */
export const LEARNED_OUTPUTS: readonly number[] = [OUT_TURN, OUT_THRUST, OUT_BITE];

/** Brain weights are kept within this range so mutation can't make them run away. */
export const WEIGHT_LIMIT = 4;

/** Fill `weights` with small random values scaled by each layer's fan-in. */
export function initBrainWeights(rng: Rng, weights: Float32Array, recurrent = false): void {
  const layer = (start: number, count: number, fanIn: number) => {
    for (let i = start; i < start + count; i++) weights[i] = rng.gaussian(0, 1 / Math.sqrt(fanIn));
  };
  layer(W1, HIDDEN_SIZE * INPUT_COUNT, INPUT_COUNT);
  layer(B1, HIDDEN_SIZE, INPUT_COUNT);
  layer(W2, OUTPUT_COUNT * HIDDEN_SIZE, HIDDEN_SIZE);
  layer(B2, OUTPUT_COUNT, HIDDEN_SIZE);
  if (recurrent) layer(WREC, HIDDEN_SIZE * HIDDEN_SIZE, HIDDEN_SIZE * 3);
}

/**
 * A small network (inputs -> tanh hidden -> tanh outputs) that reads its weights
 * straight from a genome view. With `recurrent` set, each hidden neuron also sees
 * all the hidden neurons' values from the previous tick, which gives it a memory.
 */
export class Brain implements BrainLike {
  /** Hidden neuron values from the last call to `think`. */
  readonly hidden = new Float32Array(HIDDEN_SIZE);
  readonly connectionCount: number;
  private readonly previous = new Float32Array(HIDDEN_SIZE);
  /** The weights in use: the genome's, until learning gives this brain its own copy. */
  private active: Float32Array;
  private live: Float32Array | null = null;
  private outputs: Float32Array | null = null;

  constructor(
    /** The inherited weights, a view of the genome. */
    readonly weights: Float32Array,
    readonly recurrent = false,
  ) {
    const expected = recurrent ? RECURRENT_WEIGHT_COUNT : BRAIN_WEIGHT_COUNT;
    if (weights.length !== expected) {
      throw new RangeError(`brain needs ${expected} weights, got ${weights.length}`);
    }
    this.active = weights;
    this.connectionCount =
      HIDDEN_SIZE * INPUT_COUNT +
      OUTPUT_COUNT * HIDDEN_SIZE +
      (recurrent ? HIDDEN_SIZE * HIDDEN_SIZE : 0);
  }

  think(inputs: Float32Array, outputs: Float32Array): void {
    const { active: w, hidden, previous, recurrent } = this;
    this.outputs = outputs;
    if (recurrent) previous.set(hidden);
    for (let h = 0; h < HIDDEN_SIZE; h++) {
      let sum = w[B1 + h];
      const row = W1 + h * INPUT_COUNT;
      for (let i = 0; i < INPUT_COUNT; i++) sum += w[row + i] * inputs[i];
      if (recurrent) {
        const back = WREC + h * HIDDEN_SIZE;
        for (let j = 0; j < HIDDEN_SIZE; j++) sum += w[back + j] * previous[j];
      }
      hidden[h] = Math.tanh(sum);
    }
    for (let o = 0; o < OUTPUT_COUNT; o++) {
      let sum = w[B2 + o];
      const row = W2 + o * HIDDEN_SIZE;
      for (let h = 0; h < HIDDEN_SIZE; h++) sum += w[row + h] * hidden[h];
      outputs[o] = Math.tanh(sum);
    }
  }

  /**
   * Adapt to what just happened. The connections into the action outputs (turn,
   * thrust, bite) are strengthened between neurons that were active together when
   * the reward was good, and weakened when it was bad (a reward-modulated Hebbian
   * rule). Then everything drifts back a little towards the inherited weights.
   * The inherited genome is never changed.
   *
   * Only the last layer learns, and only the outputs a food reward says something
   * about: a good meal tells a creature nothing about whether to reproduce or call.
   */
  learn(reward: number, rate: number, forgetting: number): void {
    if (!this.live) {
      this.live = Float32Array.from(this.weights);
      this.active = this.live;
    }
    const { live: w, weights: base, hidden, outputs } = this;
    const g = rate * reward;
    if (g !== 0 && outputs) {
      for (const o of LEARNED_OUTPUTS) {
        const post = outputs[o];
        const row = W2 + o * HIDDEN_SIZE;
        for (let h = 0; h < HIDDEN_SIZE; h++) w[row + h] += g * post * hidden[h];
        w[B2 + o] += g * post;
      }
    }
    const limit = WEIGHT_LIMIT * 1.5;
    for (let k = 0; k < w.length; k++)
      w[k] = clamp(w[k] + forgetting * (base[k] - w[k]), -limit, limit);
  }

  /** Only recurrent brains carry anything between ticks: their hidden neurons' values. */
  getState(): Float32Array | null {
    return this.recurrent ? Float32Array.from(this.hidden) : null;
  }

  setState(state: Float32Array): void {
    if (this.recurrent && state.length === this.hidden.length) this.hidden.set(state);
  }

  liveWeights(): Float32Array | null {
    return this.live;
  }

  setLiveWeights(weights: Float32Array): void {
    if (weights.length !== this.weights.length) return;
    this.live = Float32Array.from(weights);
    this.active = this.live;
  }
}

/** Offsets into the brain weights, for tests and tooling. */
export const BRAIN_LAYOUT = { W1, B1, W2, B2, WREC } as const;
