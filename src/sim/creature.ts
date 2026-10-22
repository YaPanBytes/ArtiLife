import { INPUT_COUNT, MEMORY_SIZE, OUTPUT_COUNT, OUT_MEMORY, OUT_SIGNAL } from './brain';
import { createBrain, type BrainKind, type BrainLike } from './brains';
import { brainWeights, decodeTraits, genomeLength, isValidGenome, type Traits } from './genome';
import { SENSE_INPUT_COUNT } from './senses';

export class Creature {
  readonly traits: Traits;
  readonly brain: BrainLike;
  /** Brain inputs: senses, then memory. Refilled every tick. */
  readonly inputs = new Float32Array(INPUT_COUNT);
  readonly outputs = new Float32Array(OUTPUT_COUNT);
  /** Memory neuron values carried to the next tick. */
  readonly memory = new Float32Array(MEMORY_SIZE);
  age = 0;
  /** Current speed in tiles per tick, along the heading. */
  speed = 0;
  /** The call this creature is making this tick, from -1 to 1. */
  signal = 0;
  /** Which species this creature belongs to. Set by the species tracker. */
  speciesId = 0;
  /** The genome new members are compared with to decide species membership. */
  speciesRef: Float32Array;
  /** Tick this creature was born (0 for the first creatures). */
  birthTick = 0;
  /** 1 if another creature bit this one last tick, else 0. */
  hurt = 0;
  /** Who this creature is trying to bite this tick, if anyone. */
  biteTarget: Creature | null = null;
  /** Whether the brain asked for a bite this tick (a cost, even with no target). */
  biting = false;
  /** Damage other creatures plan to do to this one this tick. Scratch space for the bite phase. */
  incomingDamage = 0;
  /** Energy gained from eating and biting this tick, less damage taken: what learning responds to. */
  reward = 0;
  /** The reward this creature has come to expect, a running average. Only surprises are learned from. */
  rewardBaseline = 0;

  constructor(
    readonly id: number,
    public x: number,
    public y: number,
    /** Radians; 0 points along +x, and angles grow clockwise on screen (+y is down). */
    public heading: number,
    public energy: number,
    readonly genome: Float32Array,
    readonly parentId: number | null = null,
    /** Generations since the founders: 0 for the first creatures, parent + 1 for children. */
    readonly generation = 0,
    /** Which kind of brain the genome describes. */
    readonly brainKind: BrainKind = 'mlp',
  ) {
    if (!isValidGenome(genome, brainKind)) {
      const expected = genomeLength(brainKind);
      throw new RangeError(
        expected === null
          ? `not a valid ${brainKind} genome (${genome.length} genes)`
          : `genome needs ${expected} genes, got ${genome.length}`,
      );
    }
    this.speciesRef = genome;
    this.traits = decodeTraits(genome);
    this.brain = createBrain(brainKind, brainWeights(genome));
  }

  /** Run the brain on the senses already written to `inputs`, and store the new memory. */
  think(): void {
    const { inputs, outputs, memory } = this;
    for (let i = 0; i < MEMORY_SIZE; i++) inputs[SENSE_INPUT_COUNT + i] = memory[i];
    this.brain.think(inputs, outputs);
    for (let i = 0; i < MEMORY_SIZE; i++) memory[i] = outputs[OUT_MEMORY + i];
    this.signal = outputs[OUT_SIGNAL];
  }
}
