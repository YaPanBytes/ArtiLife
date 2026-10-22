import { base64ToBytes, base64ToFloats, bytesToBase64, floatsToBase64 } from './base64';
import type { ChronicleState } from './chronicle';
import { resolveConfig, type SimConfig } from './config';
import { Creature } from './creature';
import type { Modifier } from './disasters';
import type { SimEvent } from './events';
import { genomeLength, isValidGenome } from './genome';
import type { BrainKind } from './brains';
import { InnovationRegistry, type InnovationState } from './neat';
import type { HistoryState } from './history';
import type { RngState } from './rng';
import { Archipelago } from './archipelago';
import { Rng } from './rng';
import { Simulation, type SimStats } from './simulation';
import type { SpeciesState } from './species';

export const SAVE_FORMAT = 'artilife';
/** Bump when the saved layout changes in a way old files can't be read. */
export const SAVE_VERSION = 1;

interface SavedCreature {
  id: number;
  parentId: number | null;
  x: number;
  y: number;
  heading: number;
  speed: number;
  energy: number;
  age: number;
  generation: number;
  hurt: number;
  signal: number;
  speciesId: number;
  birthTick: number;
  memory: number[];
  /** Base64 of the genome's floats. */
  genome: string;
  /** Index into `refs`: the genome this creature's species membership is measured against. */
  ref: number;
  /** Base64 of the brain weights as adapted by learning, if it has learned. */
  live?: string;
  /** Base64 of what the brain carries between ticks, for brains that do. */
  brainState?: string;
  /** The reward the creature has come to expect. */
  baseline?: number;
}

/** A whole run, as plain data that survives JSON. Loading it continues the run exactly. */
export interface SavedState {
  format: typeof SAVE_FORMAT;
  version: number;
  config: SimConfig;
  tick: number;
  nextId: number;
  rng: RngState;
  stats: SimStats;
  modifiers: Modifier[];
  /** Null stands for "never", which JSON can't write as -Infinity. */
  lastSpeciationAnnounced: number | null;
  world: { terrain: string; fertility: string; food: string };
  creatures: SavedCreature[];
  refs: string[];
  species: SpeciesState;
  events: { events: SimEvent[]; version: number };
  history: HistoryState;
  chronicle: ChronicleState;
  /** NEAT's numbering of connections and neurons. Absent in saves from before brains could evolve. */
  innovations?: InnovationState;
}

/** Capture a simulation. Call between ticks. */
export function saveSimulation(sim: Simulation): SavedState {
  // Reference genomes are shared between creatures and species; store each once.
  const refIndex = new Map<Float32Array, number>();
  const refs: string[] = [];
  const refOf = (ref: Float32Array): number => {
    let i = refIndex.get(ref);
    if (i === undefined) {
      i = refs.length;
      refs.push(floatsToBase64(ref));
      refIndex.set(ref, i);
    }
    return i;
  };

  const species = sim.species.getState(refOf);
  const creatures = sim.creatures.map((c): SavedCreature => ({
    id: c.id,
    parentId: c.parentId,
    x: c.x,
    y: c.y,
    heading: c.heading,
    speed: c.speed,
    energy: c.energy,
    age: c.age,
    generation: c.generation,
    hurt: c.hurt,
    signal: c.signal,
    speciesId: c.speciesId,
    birthTick: c.birthTick,
    memory: Array.from(c.memory),
    genome: floatsToBase64(c.genome),
    ref: refOf(c.speciesRef),
    live: ((live) => (live ? floatsToBase64(live) : undefined))(c.brain.liveWeights()),
    baseline: c.rewardBaseline || undefined,
    brainState: ((state) => (state ? floatsToBase64(state) : undefined))(c.brain.getState()),
  }));

  const { world } = sim;
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    config: structuredClone(sim.config),
    tick: sim.tick,
    nextId: sim['nextId'],
    rng: sim.rng.getState(),
    stats: { ...sim.stats },
    modifiers: structuredClone(sim.modifiers),
    lastSpeciationAnnounced: Number.isFinite(sim['lastSpeciationAnnounced'])
      ? sim['lastSpeciationAnnounced']
      : null,
    world: {
      terrain: bytesToBase64(world.terrain),
      fertility: floatsToBase64(world.fertility),
      food: floatsToBase64(world.food),
    },
    creatures,
    refs,
    species,
    events: { events: sim.events.events.slice(), version: sim.events.version },
    history: sim.history.getState(),
    chronicle: sim['chronicle'].getState(),
    innovations: sim.innovations.getState(),
  };
}

function describeBadGenome(length: number, kind: string): string {
  const expected = genomeLength(kind as BrainKind);
  return expected === null
    ? `a genome with ${length} genes is not a valid ${kind} brain`
    : `a genome has ${length} genes, expected ${expected}`;
}

function fail(message: string): never {
  throw new RangeError(`cannot load save: ${message}`);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Rebuild a simulation from a saved state. Throws a RangeError, with a reason, if it is not a valid save. */
export function loadSimulation(input: unknown, innovations?: InnovationRegistry): Simulation {
  if (!isObject(input)) fail('not an object');
  if (input.format !== SAVE_FORMAT) fail('this is not an ArtiLife save');
  if (input.version !== SAVE_VERSION) {
    fail(`it is version ${String(input.version)}, but this game reads version ${SAVE_VERSION}`);
  }
  const state = input as unknown as SavedState;
  for (const key of [
    'config',
    'rng',
    'world',
    'creatures',
    'refs',
    'species',
    'events',
    'history',
    'chronicle',
    'stats',
  ]) {
    if (!(key in state)) fail(`missing "${key}"`);
  }
  if (!Array.isArray(state.creatures) || !Array.isArray(state.refs))
    fail('creatures and refs must be lists');
  if (!Array.isArray(state.rng) || state.rng.length !== 4) fail('bad random number state');

  const config = resolveConfig(state.config);
  // Build with no founders; they are replaced by the saved creatures below.
  const sim = new Simulation(
    { ...config, creatures: { ...config.creatures, initialCount: 0 } },
    innovations,
  );
  sim.config.creatures.initialCount = config.creatures.initialCount;

  const { world } = sim;
  const terrain = base64ToBytes(state.world.terrain);
  const fertility = base64ToFloats(state.world.fertility);
  const food = base64ToFloats(state.world.food);
  if (
    terrain.length !== world.terrain.length ||
    fertility.length !== world.fertility.length ||
    food.length !== world.food.length
  ) {
    fail('the map size does not match the saved settings');
  }
  world.terrain.set(terrain);
  world.fertility.set(fertility);
  world.food.set(food);

  sim.rng.setState(state.rng);
  sim.tick = state.tick;
  sim['nextId'] = state.nextId;
  Object.assign(sim.stats, state.stats);
  sim.modifiers = structuredClone(state.modifiers ?? []);
  sim['lastSpeciationAnnounced'] = state.lastSpeciationAnnounced ?? -Infinity;

  const refs = state.refs.map((text) => {
    const genes = base64ToFloats(text);
    if (!isValidGenome(genes, sim.brainKind)) fail(describeBadGenome(genes.length, sim.brainKind));
    return genes;
  });
  const refAt = (i: number): Float32Array => refs[i] ?? fail(`unknown genome reference ${i}`);
  sim.species.setState(state.species, refAt);

  sim.creatures = state.creatures.map((s) => {
    const genome = base64ToFloats(s.genome);
    if (!isValidGenome(genome, sim.brainKind))
      fail(describeBadGenome(genome.length, sim.brainKind));
    const c = new Creature(
      s.id,
      s.x,
      s.y,
      s.heading,
      s.energy,
      genome,
      s.parentId,
      s.generation,
      sim.brainKind,
    );
    if (s.live) c.brain.setLiveWeights(base64ToFloats(s.live));
    if (s.brainState) c.brain.setState(base64ToFloats(s.brainState));
    c.rewardBaseline = s.baseline ?? 0;
    c.speed = s.speed;
    c.age = s.age;
    c.hurt = s.hurt;
    c.signal = s.signal;
    c.speciesId = s.speciesId;
    c.birthTick = s.birthTick;
    c.memory.set(s.memory);
    c.speciesRef = refAt(s.ref);
    return c;
  });

  sim.events.restore(state.events.events, state.events.version);
  sim.history.setState(state.history);
  sim['chronicle'].setState(state.chronicle);
  // With a shared registry the caller restores it once; otherwise this run owns its numbering.
  if (!innovations && state.innovations) sim.innovations.setState(state.innovations);
  return sim;
}

/** A run as a JSON string, ready to write to a file. */
export function saveToJson(sim: Simulation): string {
  return JSON.stringify(saveSimulation(sim));
}

/** Read a JSON save. Throws a RangeError with a reason if it can't be used. */
export function loadFromJson(text: string): Simulation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('the file is not valid JSON');
  }
  return loadSimulation(parsed);
}

/** Version of the container that holds several islands. */
export const ARCHIPELAGO_VERSION = 2;

/** A whole archipelago: every island's state, which one is on screen, and the shared bookkeeping. */
export interface SavedArchipelago {
  format: typeof SAVE_FORMAT;
  version: typeof ARCHIPELAGO_VERSION;
  active: number;
  rng: RngState;
  innovations: InnovationState;
  islands: SavedState[];
}

export function saveArchipelago(archipelago: Archipelago, active = 0): SavedArchipelago {
  return {
    format: SAVE_FORMAT,
    version: ARCHIPELAGO_VERSION,
    active,
    rng: archipelago.rng.getState(),
    innovations: archipelago.innovations.getState(),
    // The numbering is shared, so it is stored once, above, and not in each island.
    islands: archipelago.sims.map((sim) => {
      const state = saveSimulation(sim);
      delete state.innovations;
      return state;
    }),
  };
}

/**
 * Rebuild an archipelago. Accepts both the island container and a plain single-world
 * save from before islands existed, which becomes an archipelago of one.
 */
export function loadArchipelago(input: unknown): { archipelago: Archipelago; active: number } {
  if (!isObject(input)) fail('not an object');
  if (input.format !== SAVE_FORMAT) fail('this is not an ArtiLife save');
  if (input.version === SAVE_VERSION) {
    const sim = loadSimulation(input);
    const rng = new Rng(sim.config.seed);
    return {
      archipelago: new Archipelago({}, { sims: [sim], innovations: sim.innovations, rng }),
      active: 0,
    };
  }
  if (input.version !== ARCHIPELAGO_VERSION) {
    fail(
      `it is version ${String(input.version)}, but this game reads versions ${SAVE_VERSION} and ${ARCHIPELAGO_VERSION}`,
    );
  }
  const state = input as unknown as SavedArchipelago;
  if (!Array.isArray(state.islands) || state.islands.length === 0)
    fail('there are no islands in it');
  if (!Array.isArray(state.rng) || state.rng.length !== 4) fail('bad random number state');
  if (!isObject(state.innovations)) fail('missing "innovations"');
  const innovations = new InnovationRegistry();
  innovations.setState(state.innovations);
  const sims = state.islands.map((island) => loadSimulation(island, innovations));
  const rng = new Rng(0);
  rng.setState(state.rng);
  const active =
    Number.isInteger(state.active) && state.active >= 0 && state.active < sims.length
      ? state.active
      : 0;
  return { archipelago: new Archipelago({}, { sims, innovations, rng }), active };
}

export function saveArchipelagoToJson(archipelago: Archipelago, active = 0): string {
  return JSON.stringify(saveArchipelago(archipelago, active));
}

export function loadArchipelagoFromJson(text: string): {
  archipelago: Archipelago;
  active: number;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('the file is not valid JSON');
  }
  return loadArchipelago(parsed);
}
