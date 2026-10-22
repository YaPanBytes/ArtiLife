// Headless runner: steps a simulation and prints population and trait statistics.
// Usage: npm run sim -- [--seed 1] [--ticks 20000] [--every 1000]
import { TRAIT_ORDER } from '../sim/genome';
import { Simulation } from '../sim/simulation';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const seed = arg('seed', 1);
const ticks = arg('ticks', 20000);
const every = arg('every', 1000);
const sim = new Simulation({ seed });

const traits = TRAIT_ORDER.filter((t) => t !== 'hue');
console.log(['tick', 'pop', 'births', 'starved', 'old', 'gen', 'energy', ...traits].join('\t'));

function report(): void {
  const n = sim.creatures.length;
  const mean = (f: (c: (typeof sim.creatures)[number]) => number) =>
    n === 0 ? NaN : sim.creatures.reduce((sum, c) => sum + f(c), 0) / n;
  const row = [
    sim.tick,
    n,
    sim.stats.births,
    sim.stats.starved,
    sim.stats.diedOfAge,
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
