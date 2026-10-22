import { describe, expect, it } from 'vitest';
import {
  BRAIN_LAYOUT,
  BRAIN_WEIGHT_COUNT,
  Brain,
  HIDDEN_SIZE,
  INPUT_COUNT,
  LEARNED_OUTPUTS,
  OUTPUT_COUNT,
  OUT_MEMORY,
  OUT_REPRODUCE,
  OUT_SIGNAL,
  OUT_TURN,
  WEIGHT_LIMIT,
} from '../src/sim/brain';
import { TRAIT_COUNT } from '../src/sim/genome';
import { Rng } from '../src/sim/rng';
import { loadFromJson, saveToJson } from '../src/sim/serialize';
import { Simulation } from '../src/sim/simulation';
import { lifeSim, makeCreature } from './helpers';

const activeBrain = () => {
  const rng = new Rng(3);
  const weights = Float32Array.from({ length: BRAIN_WEIGHT_COUNT }, () => rng.gaussian(0, 0.3));
  const brain = new Brain(weights);
  const inputs = new Float32Array(INPUT_COUNT).fill(0.5);
  const outputs = new Float32Array(OUTPUT_COUNT);
  brain.think(inputs, outputs);
  return { brain, weights, inputs, outputs };
};

describe('learning in a brain', () => {
  it('starts with no private weights, and the inherited ones are never touched', () => {
    const { brain, weights } = activeBrain();
    expect(brain.liveWeights()).toBeNull();
    const before = Float32Array.from(weights);
    brain.learn(1, 0.1, 0);
    expect(brain.liveWeights()).not.toBeNull();
    expect(Array.from(weights)).toEqual(Array.from(before));
    expect(Array.from(brain.liveWeights()!)).not.toEqual(Array.from(before));
  });

  it('strengthens what was active with a reward and weakens it with a penalty, on the action outputs', () => {
    const up = activeBrain();
    const down = activeBrain();
    up.brain.learn(1, 0.05, 0);
    down.brain.learn(-1, 0.05, 0);
    const hidden = Array.from(up.brain.hidden).findIndex((h) => Math.abs(h) > 0.1);
    const i = BRAIN_LAYOUT.W2 + OUT_TURN * HIDDEN_SIZE + hidden;
    const base = up.weights[i];
    const direction = Math.sign(up.outputs[OUT_TURN] * up.brain.hidden[hidden]);
    expect((up.brain.liveWeights()![i] - base) * direction).toBeGreaterThan(0);
    expect((down.brain.liveWeights()![i] - base) * direction).toBeLessThan(0);
  });

  it('only adapts the connections into turn, thrust and bite', () => {
    const { brain, weights } = activeBrain();
    for (let k = 0; k < 20; k++) brain.learn(1, 0.1, 0);
    const live = brain.liveWeights()!;
    const changed = (from: number, to: number) =>
      live.slice(from, to).some((w, k) => w !== weights[from + k]);
    for (const o of LEARNED_OUTPUTS) {
      expect(
        changed(BRAIN_LAYOUT.W2 + o * HIDDEN_SIZE, BRAIN_LAYOUT.W2 + (o + 1) * HIDDEN_SIZE),
      ).toBe(true);
    }
    for (const o of [OUT_REPRODUCE, OUT_SIGNAL, OUT_MEMORY]) {
      expect(
        changed(BRAIN_LAYOUT.W2 + o * HIDDEN_SIZE, BRAIN_LAYOUT.W2 + (o + 1) * HIDDEN_SIZE),
      ).toBe(false);
    }
    expect(changed(BRAIN_LAYOUT.W1, BRAIN_LAYOUT.B1 + HIDDEN_SIZE)).toBe(false); // the first layer is fixed
  });

  it('changes how it behaves', () => {
    const { brain, inputs, outputs } = activeBrain();
    const before = Float32Array.from(outputs);
    for (let k = 0; k < 20; k++) {
      brain.think(inputs, outputs);
      brain.learn(1, 0.1, 0);
    }
    brain.think(inputs, outputs);
    expect(Array.from(outputs)).not.toEqual(Array.from(before));
  });

  it('drifts back towards the inherited weights when nothing rewards it', () => {
    const { brain, weights } = activeBrain();
    for (let k = 0; k < 10; k++) brain.learn(1, 0.2, 0);
    const learned = Float32Array.from(brain.liveWeights()!);
    const gap = (w: Float32Array) => w.reduce((s, v, k) => s + Math.abs(v - weights[k]), 0);
    for (let k = 0; k < 200; k++) brain.learn(0, 0.2, 0.05);
    expect(gap(brain.liveWeights()!)).toBeLessThan(gap(learned) * 0.01);
  });

  it('keeps weights bounded however long it is rewarded', () => {
    const { brain, inputs, outputs } = activeBrain();
    for (let k = 0; k < 3000; k++) {
      brain.think(inputs, outputs);
      brain.learn(1, 0.5, 0);
    }
    const live = brain.liveWeights()!;
    expect(live.every(Number.isFinite)).toBe(true);
    expect(Math.max(...live.map(Math.abs))).toBeLessThanOrEqual(WEIGHT_LIMIT * 1.5 + 1e-6);
  });
});

describe('learning in a simulation', () => {
  it('does nothing unless switched on', () => {
    const sim = new Simulation({ seed: 2, creatures: { initialCount: 40 } });
    for (let t = 0; t < 200; t++) sim.step();
    expect(sim.creatures.every((c) => c.brain.liveWeights() === null)).toBe(true);
  });

  it('gives every creature a reward for what it eats, and clears it each tick', () => {
    const sim = lifeSim({
      learning: { rate: 0.1 },
      creatures: { basalCost: 0, moveCost: 0, senseCost: 0 },
    });
    const c = makeCreature(5.5, 5.5, 0, { size: 1 }, 20);
    sim.creatures.push(c);
    sim.world.food[sim.world.tileIndex(5, 5)] = 10;
    sim['eatPhase']();
    expect(c.reward).toBeCloseTo(2, 9);
    sim.step();
    expect(c.reward).toBe(0);
  });

  it('rewards a biter and penalises its victim', () => {
    const sim = lifeSim();
    const wolf = makeCreature(10, 10, 0, { diet: 1, size: 0.5 }, 50);
    wolf.genome[TRAIT_COUNT + BRAIN_LAYOUT.B2 + 3] = 5; // always bite
    const deer = makeCreature(10.8, 10, 0, {}, 50);
    sim.creatures.push(wolf, deer);
    let seen = [0, 0];
    const original = sim['learnPhase'].bind(sim);
    sim['learnPhase'] = () => {
      seen = [wolf.reward, deer.reward];
      original();
    };
    sim.step();
    expect(seen[0]).toBeGreaterThan(0);
    expect(seen[1]).toBeLessThan(0);
  });

  it('gives creatures their own adapted weights, which children do not inherit', () => {
    const sim = new Simulation({
      seed: 2,
      learning: { rate: 0.1 },
      creatures: { initialCount: 60 },
    });
    for (let t = 0; t < 400; t++) sim.step();
    const learned = sim.creatures.filter((c) => c.brain.liveWeights() !== null);
    expect(learned.length).toBeGreaterThan(0);
    // A newborn has not had a tick to learn in, and does not inherit its parent's adapted weights.
    const newborns = sim.creatures.filter((c) => c.age === 0);
    expect(newborns.length).toBeGreaterThan(0);
    expect(newborns.every((c) => c.brain.liveWeights() === null)).toBe(true);
    // Inherited weights are the genome's, whatever learning has done.
    const c = learned[0];
    expect(Array.from(c.brain.liveWeights()!)).not.toEqual(Array.from((c.brain as Brain).weights));
    expect(sim.creatures.some((x) => x.generation > 0)).toBe(true);
  });

  it('never blows up', () => {
    const sim = new Simulation({
      seed: 5,
      learning: { rate: 0.5, forgetting: 0 },
      creatures: { initialCount: 60 },
    });
    for (let t = 0; t < 1500; t++) sim.step();
    for (const c of sim.creatures) {
      const live = c.brain.liveWeights()!;
      expect(live.every(Number.isFinite)).toBe(true);
      expect(Number.isFinite(c.energy)).toBe(true);
    }
  });

  it('saves and loads exactly, adapted weights included', () => {
    const make = () =>
      new Simulation({ seed: 8, learning: { rate: 0.1 }, creatures: { initialCount: 60 } });
    const original = make();
    for (let t = 0; t < 250; t++) original.step();
    const loaded = loadFromJson(saveToJson(original));
    expect(saveToJson(loaded)).toBe(saveToJson(original));
    for (let t = 0; t < 250; t++) {
      original.step();
      loaded.step();
    }
    expect(saveToJson(loaded)).toBe(saveToJson(original));
  });

  it('learns from surprises, not from a steady income', () => {
    const sim = lifeSim({ learning: { rate: 0.1 } });
    const c = makeCreature(10, 10);
    sim.creatures.push(c);
    const learned: number[] = [];
    const real = c.brain.learn.bind(c.brain);
    c.brain.learn = (reward, rate, forgetting) => {
      learned.push(reward);
      real(reward, rate, forgetting);
    };
    // A steady 1 energy every tick: at first a pleasant surprise, soon just normal.
    for (let t = 0; t < 400; t++) {
      c.reward = 1;
      sim['learnPhase']();
    }
    expect(learned[0]).toBeGreaterThan(0.15);
    expect(Math.abs(learned[learned.length - 1])).toBeLessThan(0.001);
    // Then nothing arrives: that is a disappointment.
    c.reward = 0;
    sim['learnPhase']();
    expect(learned[learned.length - 1]).toBeLessThan(-0.1);
  });

  it('keeps the expected reward in a save', () => {
    const sim = new Simulation({
      seed: 3,
      learning: { rate: 0.1 },
      creatures: { initialCount: 30 },
    });
    for (let t = 0; t < 200; t++) sim.step();
    expect(sim.creatures.some((c) => c.rewardBaseline !== 0)).toBe(true);
    const loaded = loadFromJson(saveToJson(sim));
    expect(loaded.creatures.map((c) => c.rewardBaseline)).toEqual(
      sim.creatures.map((c) => c.rewardBaseline),
    );
  });
});
