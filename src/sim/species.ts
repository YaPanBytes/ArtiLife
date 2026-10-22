import type { BrainKind } from './brains';
import { decodeTraits, genomeDifference } from './genome';

export type DietClass = 'HERBIVORE' | 'OMNIVORE' | 'HUNTER';

/** Plant eaters, mixed feeders and hunters, for labels and colours. */
export function dietClass(diet: number): DietClass {
  return diet < 0.25 ? 'HERBIVORE' : diet < 0.6 ? 'OMNIVORE' : 'HUNTER';
}

/**
 * How different two genomes are, from 0 (identical): body traits and brain genes
 * count equally, each as a root-mean-square difference.
 */
export function genomeDistance(a: Float32Array, b: Float32Array, kind: BrainKind = 'mlp'): number {
  return genomeDifference(a, b, kind);
}

export interface SpeciesInfo {
  id: number;
  /** The species this one branched from, or null for the founders' species. */
  parentId: number | null;
  bornTick: number;
  /** Tick the last member died, or null while any are alive. */
  extinctTick: number | null;
  /** Members alive now. */
  count: number;
  /** Most members alive at once. */
  peak: number;
  /** Diet and hue of the species' founding genome. */
  diet: number;
  hue: number;
}

interface Tracked extends SpeciesInfo {
  /** The genome new creatures are compared against to decide whether they still belong. */
  ref: Float32Array;
}

/** The species table in plain data, for saving. `ref` is an index into the saver's genome table. */
export interface SpeciesState {
  nextId: number;
  version: number;
  species: (SpeciesInfo & { ref: number })[];
}

/** What a creature needs to carry so the tracker can follow it. */
export interface Classifiable {
  genome: Float32Array;
  speciesId: number;
  speciesRef: Float32Array;
}

/**
 * Follows species through time. This is bookkeeping for display and analysis:
 * nothing in the simulation reads it.
 *
 * A child belongs to its parent's species until it drifts further than the
 * threshold from that species' reference genome; then it founds a new species,
 * recorded as a branch from the parent's. The first creatures all start in one
 * species, each keeping its own genome as the reference, so the random founders
 * do not count as separate species.
 */
export class SpeciesTracker {
  private readonly species = new Map<number, Tracked>();
  private nextId = 1;
  /** Bumped whenever the list of species changes, so views know to refresh. */
  version = 0;

  constructor(
    private readonly threshold: () => number,
    private readonly kind: () => BrainKind,
    private readonly onSpeciation?: (child: SpeciesInfo, parent: SpeciesInfo) => void,
    private readonly onExtinction?: (species: SpeciesInfo) => void,
  ) {}

  private create(parentId: number | null, genome: Float32Array, tick: number): Tracked {
    const traits = decodeTraits(genome);
    const species: Tracked = {
      id: this.nextId++,
      parentId,
      bornTick: tick,
      extinctTick: null,
      count: 0,
      peak: 0,
      diet: traits.diet,
      hue: traits.hue,
      ref: Float32Array.from(genome),
    };
    this.species.set(species.id, species);
    this.version++;
    return species;
  }

  private join(c: Classifiable, species: Tracked): void {
    c.speciesId = species.id;
    species.count++;
    if (species.count > species.peak) species.peak = species.count;
    species.extinctTick = null;
  }

  /** Register one of the first creatures. They all share the first species. */
  addFounder(c: Classifiable, tick: number): void {
    const first = this.species.get(1) ?? this.create(null, c.genome, tick);
    this.join(c, first);
    c.speciesRef = c.genome;
    this.version++;
  }

  /**
   * Register creatures brought in from outside as a new species of their own, with
   * no parent species. They all compare against the first one's genome.
   */
  addImmigrants(group: Classifiable[], tick: number): void {
    if (group.length === 0) return;
    const species = this.create(null, group[0].genome, tick);
    for (const c of group) {
      this.join(c, species);
      c.speciesRef = species.ref;
    }
    this.version++;
  }

  /**
   * Place a creature that arrived from elsewhere: in the closest living species, if
   * its genome is within the threshold of that species' reference, else in a new species of its own.
   */
  adopt(c: Classifiable, tick: number): void {
    let best: Tracked | null = null;
    let bestDistance = Infinity;
    for (const species of this.species.values()) {
      if (species.count === 0) continue;
      const d = genomeDistance(c.genome, species.ref, this.kind());
      if (d < bestDistance) {
        best = species;
        bestDistance = d;
      }
    }
    if (best && bestDistance <= this.threshold()) {
      this.join(c, best);
      c.speciesRef = best.ref;
    } else {
      const created = this.create(null, c.genome, tick);
      this.join(c, created);
      c.speciesRef = created.ref;
    }
    this.version++;
  }

  /** Place a newborn, starting a new species if it has drifted too far from its parent's. */
  addChild(child: Classifiable, parent: Classifiable, tick: number): void {
    const parentSpecies = this.species.get(parent.speciesId);
    if (!parentSpecies) return;
    if (genomeDistance(child.genome, parent.speciesRef, this.kind()) <= this.threshold()) {
      this.join(child, parentSpecies);
      child.speciesRef = parent.speciesRef;
    } else {
      const created = this.create(parentSpecies.id, child.genome, tick);
      this.join(child, created);
      child.speciesRef = created.ref;
      this.onSpeciation?.(created, parentSpecies);
    }
    this.version++;
  }

  remove(c: Classifiable, tick: number): void {
    const species = this.species.get(c.speciesId);
    if (!species) return;
    species.count--;
    if (species.count === 0 && species.extinctTick === null) {
      species.extinctTick = tick;
      this.onExtinction?.(species);
    }
    this.version++;
  }

  /** Species in plain data. `refOf` turns a reference genome into a key the caller can look up later. */
  getState(refOf: (ref: Float32Array) => number): SpeciesState {
    return {
      nextId: this.nextId,
      version: this.version,
      species: [...this.species.values()].map(({ ref, ...info }) => ({ ...info, ref: refOf(ref) })),
    };
  }

  setState(state: SpeciesState, refAt: (index: number) => Float32Array): void {
    this.species.clear();
    this.nextId = state.nextId;
    this.version = state.version;
    for (const { ref, ...info } of state.species)
      this.species.set(info.id, { ...info, ref: refAt(ref) });
  }

  get(id: number): SpeciesInfo | undefined {
    return this.species.get(id);
  }

  /** All species ever seen, oldest first. */
  list(): SpeciesInfo[] {
    return [...this.species.values()].map(({ ref: _ref, ...info }) => info);
  }

  get aliveCount(): number {
    let n = 0;
    for (const s of this.species.values()) if (s.count > 0) n++;
    return n;
  }
}
