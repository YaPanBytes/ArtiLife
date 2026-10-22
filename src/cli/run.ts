// Headless runner: steps a simulation and prints population and trait statistics.
// Usage: npm run sim -- [--seed 1] [--ticks 20000] [--every 1000] [--preset lush_eden] [--set path=value]
import { findPreset } from '../presets';
import { TRAIT_ORDER } from '../sim/genome';
import { Simulation } from '../sim/simulation';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

/** Config overrides from the command line: --set predation.biteCost=0.1 (repeatable). */
function overrides(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  process.argv.forEach((a, i) => {
    if (a !== '--set') return;
    const [path, value] = process.argv[i + 1].split('=');
    const keys = path.split('.');
    let node = out;
    for (const key of keys.slice(0, -1)) node = (node[key] ??= {}) as Record<string, unknown>;
    node[keys[keys.length - 1]] =
      value === 'true' ? true : value === 'false' ? false : Number(value);
  });
  return out;
}

const seed = arg('seed', 1);

/** Preset first, then --set overrides on top. */
function mergeOverrides(base: object, extra: object, seed: number): Record<string, unknown> {
  const out: Record<string, unknown> = structuredClone(base) as Record<string, unknown>;
  const merge = (target: Record<string, unknown>, source: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(source)) {
      if (typeof v === 'object' && v !== null)
        merge((target[k] ??= {}) as Record<string, unknown>, v as Record<string, unknown>);
      else target[k] = v;
    }
  };
  merge(out, extra as Record<string, unknown>);
  out.seed = seed;
  return out;
}
const ticks = arg('ticks', 20000);
const every = arg('every', 1000);
const presetName = process.argv[process.argv.indexOf('--preset') + 1];
const preset = process.argv.includes('--preset')
  ? findPreset(presetName.replace(/_/g, ' ').toUpperCase())
  : undefined;
if (process.argv.includes('--preset') && !preset) {
  console.error(`unknown preset "${presetName}"`);
  process.exit(1);
}
const sim = new Simulation(mergeOverrides(preset?.config ?? {}, overrides(), seed));

const traits = TRAIT_ORDER.filter((t) => t !== 'hue');
console.log(
  [
    'tick',
    'pop',
    'births',
    'starved',
    'eaten',
    'old',
    'bites',
    'carn%',
    'gen',
    'energy',
    ...traits,
  ].join('\t'),
);

function report(): void {
  const n = sim.creatures.length;
  const mean = (f: (c: (typeof sim.creatures)[number]) => number) =>
    n === 0 ? NaN : sim.creatures.reduce((sum, c) => sum + f(c), 0) / n;
  const row = [
    sim.tick,
    n,
    sim.stats.births,
    sim.stats.starved,
    sim.stats.eaten,
    sim.stats.diedOfAge,
    sim.stats.bites,
    n === 0 ? 0 : Math.round((100 * sim.creatures.filter((c) => c.traits.diet > 0.5).length) / n),
    mean((c) => c.generation).toFixed(1),
    mean((c) => c.energy).toFixed(0),
    ...traits.map((t) => mean((c) => c.traits[t]).toFixed(3)),
  ];
  console.log(row.join('\t'));
}

report();
for (let t = 1; t <= ticks; t++) {
  sim.step();
  if (t % every === 0) report();
  if (sim.creatures.length === 0) {
    console.log(`extinct at tick ${sim.tick}`);
    break;
  }
}
