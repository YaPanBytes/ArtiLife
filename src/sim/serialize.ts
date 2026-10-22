import { base64ToBytes, base64ToFloats, bytesToBase64, floatsToBase64 } from './base64';
import type { ChronicleState } from './chronicle';
import { resolveConfig, type SimConfig } from './config';
import { Creature } from './creature';
import type { Modifier } from './disasters';
import type { SimEvent } from './events';
import { GENOME_LENGTH } from './genome';
import type { HistoryState } from './history';
import type { RngState } from './rng';
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
  };
}

function fail(message: string): never {
  throw new RangeError(`cannot load save: ${message}`);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Rebuild a simulation from a saved state. Throws a RangeError, with a reason, if it is not a valid save. */
export function loadSimulation(input: unknown): Simulation {
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
  const sim = new Simulation({ ...config, creatures: { ...config.creatures, initialCount: 0 } });
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
    if (genes.length !== GENOME_LENGTH)
      fail(`a genome has ${genes.length} genes, expected ${GENOME_LENGTH}`);
    return genes;
  });
  const refAt = (i: number): Float32Array => refs[i] ?? fail(`unknown genome reference ${i}`);
  sim.species.setState(state.species, refAt);

  sim.creatures = state.creatures.map((s) => {
    const genome = base64ToFloats(s.genome);
    if (genome.length !== GENOME_LENGTH)
      fail(`a creature has ${genome.length} genes, expected ${GENOME_LENGTH}`);
    const c = new Creature(s.id, s.x, s.y, s.heading, s.energy, genome, s.parentId, s.generation);
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
