import { describe, expect, it } from 'vitest';
import { GENOME_LENGTH, TRAIT_COUNT, randomGenome } from '../src/sim/genome';
import { Rng } from '../src/sim/rng';
import { Simulation } from '../src/sim/simulation';
import {
  SpeciesTracker,
  dietClass,
  genomeDistance,
  type Classifiable,
  type SpeciesInfo,
} from '../src/sim/species';

const member = (genome: Float32Array): Classifiable => ({
  genome,
  speciesId: 0,
  speciesRef: genome,
});

describe('dietClass', () => {
  it('splits diets into herbivore, omnivore and hunter', () => {
    expect(dietClass(0)).toBe('HERBIVORE');
    expect(dietClass(0.24)).toBe('HERBIVORE');
    expect(dietClass(0.25)).toBe('OMNIVORE');
    expect(dietClass(0.59)).toBe('OMNIVORE');
    expect(dietClass(0.6)).toBe('HUNTER');
    expect(dietClass(1)).toBe('HUNTER');
  });
});

describe('genomeDistance', () => {
  const a = randomGenome(new Rng(1));

  it('is zero for identical genomes and symmetric', () => {
    const b = randomGenome(new Rng(2));
    expect(genomeDistance(a, a)).toBe(0);
    expect(genomeDistance(a, b)).toBeCloseTo(genomeDistance(b, a), 12);
    expect(genomeDistance(a, b)).toBeGreaterThan(0);
  });

  it('counts body traits and brain weights equally, each averaged over its own genes', () => {
    const traitsOnly = Float32Array.from(a);
    for (let i = 0; i < TRAIT_COUNT; i++) traitsOnly[i] += 0.3;
    const weightsOnly = Float32Array.from(a);
    for (let i = TRAIT_COUNT; i < GENOME_LENGTH; i++) weightsOnly[i] += 0.3;
    expect(genomeDistance(a, traitsOnly)).toBeCloseTo(genomeDistance(a, weightsOnly), 6);
    expect(genomeDistance(a, traitsOnly)).toBeCloseTo(Math.sqrt(0.09 / 2), 6);
  });

  it('grows as more genes change', () => {
    const few = Float32Array.from(a);
    const many = Float32Array.from(a);
    for (let i = TRAIT_COUNT; i < TRAIT_COUNT + 10; i++) few[i] += 0.5;
    for (let i = TRAIT_COUNT; i < TRAIT_COUNT + 100; i++) many[i] += 0.5;
    expect(genomeDistance(a, many)).toBeGreaterThan(genomeDistance(a, few));
  });
});

describe('SpeciesTracker', () => {
  const make = (threshold = 0.1) => {
    const branches: [SpeciesInfo, SpeciesInfo][] = [];
    const extinct: SpeciesInfo[] = [];
    const tracker = new SpeciesTracker(
      () => threshold,
      () => 'mlp',
      (child, parent) => branches.push([child, parent]),
      (s) => extinct.push(s),
    );
    return { tracker, branches, extinct };
  };
  const near = (g: Float32Array, d: number) => {
    const c = Float32Array.from(g);
    for (let i = TRAIT_COUNT; i < c.length; i++) c[i] += d;
    return c;
  };

  it('puts every founder in one species, however different they are', () => {
    const { tracker } = make();
    const rng = new Rng(3);
    const founders = Array.from({ length: 5 }, () => member(randomGenome(rng)));
    founders.forEach((f) => tracker.addFounder(f, 0));
    expect(new Set(founders.map((f) => f.speciesId)).size).toBe(1);
    expect(tracker.list().length).toBe(1);
    expect(tracker.get(1)!.count).toBe(5);
    expect(founders[2].speciesRef).toBe(founders[2].genome);
  });

  it('keeps a close child in its parent’s species and a distant one starts a new species', () => {
    const { tracker, branches } = make(0.1);
    const parent = member(randomGenome(new Rng(4)));
    tracker.addFounder(parent, 0);
    const close = member(near(parent.genome, 0.02));
    tracker.addChild(close, parent, 10);
    expect(close.speciesId).toBe(1);
    expect(branches.length).toBe(0);

    const far = member(near(parent.genome, 0.5));
    tracker.addChild(far, parent, 20);
    expect(far.speciesId).toBe(2);
    expect(branches).toHaveLength(1);
    expect(branches[0][0].id).toBe(2);
    expect(branches[0][1].id).toBe(1);
    expect(tracker.get(2)).toMatchObject({
      parentId: 1,
      bornTick: 20,
      count: 1,
      extinctTick: null,
    });
  });

  it('measures drift from the species’ founding genome, not from the parent', () => {
    const { tracker } = make(0.1);
    const founder = member(randomGenome(new Rng(5)));
    tracker.addFounder(founder, 0);
    // Each step is small, but the steps add up past the threshold.
    let parent = founder;
    const lineage: Classifiable[] = [];
    for (let i = 1; i <= 8; i++) {
      const child = member(near(parent.genome, 0.03));
      tracker.addChild(child, parent, i);
      lineage.push(child);
      parent = child;
    }
    expect(lineage[0].speciesId).toBe(1);
    expect(lineage[lineage.length - 1].speciesId).toBeGreaterThan(1);
  });

  it('tracks counts, peaks and extinction', () => {
    const { tracker, extinct } = make();
    const a = member(randomGenome(new Rng(6)));
    const b = member(randomGenome(new Rng(7)));
    tracker.addFounder(a, 0);
    tracker.addFounder(b, 0);
    expect(tracker.get(1)).toMatchObject({ count: 2, peak: 2 });
    tracker.remove(a, 50);
    expect(tracker.get(1)).toMatchObject({ count: 1, peak: 2, extinctTick: null });
    tracker.remove(b, 60);
    expect(tracker.get(1)).toMatchObject({ count: 0, extinctTick: 60 });
    expect(extinct.map((s) => s.id)).toEqual([1]);
    expect(tracker.aliveCount).toBe(0);
  });

  it('ignores creatures it never saw and bumps its version when things change', () => {
    const { tracker } = make();
    const stranger = member(randomGenome(new Rng(8)));
    expect(() => tracker.remove(stranger, 1)).not.toThrow();
    const v = tracker.version;
    tracker.addFounder(member(randomGenome(new Rng(9))), 0);
    expect(tracker.version).toBeGreaterThan(v);
  });

  it('lists species without their internal reference genome', () => {
    const { tracker } = make();
    tracker.addFounder(member(randomGenome(new Rng(10))), 0);
    expect('ref' in tracker.list()[0]).toBe(false);
    expect(Object.keys(tracker.list()[0]).sort()).toEqual(
      ['bornTick', 'count', 'diet', 'extinctTick', 'hue', 'id', 'parentId', 'peak'].sort(),
    );
  });
});

describe('species in a running simulation', () => {
  it('keeps every living creature in exactly one species, and the counts add up', () => {
    const sim = new Simulation({
      seed: 2,
      creatures: { initialCount: 60 },
      species: { threshold: 0.06 },
    });
    for (let t = 0; t < 1500; t++) sim.step();
    const total = sim.species.list().reduce((sum, s) => sum + s.count, 0);
    expect(total).toBe(sim.creatures.length);
    for (const c of sim.creatures) expect(sim.species.get(c.speciesId)).toBeDefined();
    expect(sim.species.list().length).toBeGreaterThan(1);
  });

  it('has a parent for every branch, and logs only the ones that change diet class', () => {
    const sim = new Simulation({
      seed: 2,
      creatures: { initialCount: 60 },
      species: { threshold: 0.06 },
    });
    for (let t = 0; t < 1500; t++) sim.step();
    const species = sim.species.list();
    for (const s of species) {
      if (s.parentId !== null) expect(sim.species.get(s.parentId)).toBeDefined();
    }
    const logged = sim.events.events.filter((e) => e.kind === 'speciation');
    const classChanges = species.filter(
      (s) =>
        s.parentId !== null && dietClass(s.diet) !== dietClass(sim.species.get(s.parentId)!.diet),
    );
    expect(logged.length).toBeLessThanOrEqual(species.length - 1);
    expect(logged.length).toBeLessThanOrEqual(classChanges.length);
    expect(logged.every((e) => e.major && /^NEW \w+ SPECIES \d+ \(FROM \d+\)$/.test(e.text))).toBe(
      true,
    );
    // Never more than one announcement per gap.
    for (let i = 1; i < logged.length; i++) {
      expect(logged[i].tick - logged[i - 1].tick).toBeGreaterThanOrEqual(1000);
    }
  });

  it('forms no new species when the threshold is huge', () => {
    const sim = new Simulation({
      seed: 2,
      creatures: { initialCount: 60 },
      species: { threshold: 10 },
    });
    for (let t = 0; t < 800; t++) sim.step();
    expect(sim.species.list().length).toBe(1);
  });
});
