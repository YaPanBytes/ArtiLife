// Headless runner: steps a simulation and prints population and trait statistics.
// Usage: npm run sim -- [--seed 1] [--ticks 20000] [--every 1000]
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
const ticks = arg('ticks', 20000);
const every = arg('every', 1000);
const sim = new Simulation({ ...overrides(), seed });

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
