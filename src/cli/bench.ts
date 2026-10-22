// Times the simulation: warms up a world, then reports milliseconds per tick.
// Usage: npm run bench -- [--seed 2] [--warmup 4000] [--ticks 1500]
import { Simulation } from '../sim/simulation';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const seed = arg('seed', 2);
const sim = new Simulation({ seed });
for (let t = 0; t < arg('warmup', 4000); t++) sim.step();

const ticks = arg('ticks', 1500);
let creatureTicks = 0;
const start = performance.now();
for (let t = 0; t < ticks; t++) {
  creatureTicks += sim.creatures.length;
  sim.step();
}
const ms = performance.now() - start;
console.log(
  `seed ${seed}: ${(ms / ticks).toFixed(3)} ms/tick, ` +
    `${((ms * 1000) / creatureTicks).toFixed(2)} us per creature-tick, ` +
    `${Math.round((ticks * 1000) / ms)} ticks/s, mean population ${Math.round(creatureTicks / ticks)}`,
);
