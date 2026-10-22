# ArtiLife

An artificial-life ecosystem. Creatures with small neural-net brains and heritable genomes live on a 2D map. They eat, reproduce and mutate. **There is no fitness function**: the only selection pressure is whether a creature lives long enough to have offspring.

You change the rules of the world (food supply, metabolic cost, mutation rate, terrain, disasters) and watch what evolves: grazing herds, ambush predators, scavengers, parasites, boom-and-bust cycles, and strategies nobody designed.

> **Status: planning.** Nothing is implemented yet. This README describes the intended design; see [Implementation plan](#implementation-plan) for the build order. Sections marked *(planned)* are targets, not features.

## Core idea

Evolution happens because three things are true, and nothing else is imposed:

1. **Energy is scarce.** Everything a creature does costs energy: existing, moving, growing a big body, running a big brain.
2. **Creatures can make copies of themselves**, paying energy to do so.
3. **Copies are imperfect.** Genome mutations change both body and brain.

Anything that reproduces more than it dies spreads. Roles like "predator" or "herbivore" are not coded in. They are regions of genome space that evolution may or may not find, depending on the world's rules.

## How the simulation works *(planned)*

### World
- A 2D toroidal (wrap-around) map, with an optional terrain layer: open ground, walls, water, fertile and barren zones.
- A **food field** (a grid of plant energy) that regrows at a configurable rate, optionally varying with seasons.
- A spatial hash for fast neighbour queries, so thousands of creatures run in real time.

### Creatures
Each creature has:

| Part | Contents |
| --- | --- |
| **Genome** | A flat array of floats: body traits plus all brain weights. |
| **Body traits** | Size, max speed, vision range and field of view, diet (plant↔meat efficiency), metabolic rate, colour, reproduction threshold, mutation rate. |
| **State** | Position, heading, energy, age, generation, lineage ID. |
| **Brain** | A small feed-forward neural net with a few memory neurons that carry state between ticks. |

**Brain inputs:** vision rays (distance to and kind of food / creature / wall, plus the relative size and colour of what is seen), own energy, own speed, memory neurons.

**Brain outputs:** turn, thrust, bite/eat, reproduce, and optionally a signal (a colour or sound others can perceive).

### Energy economy
- Gain: eating plants, or biting other creatures. Diet efficiency is a gene, so an animal that is good at plants is bad at meat.
- Cost: base metabolism (scales with size), movement (scales with speed²), brain size, and bite attempts.
- Death: energy reaches zero, old age, or being eaten.
- Reproduction: costs energy and splits it with the child. The child's genome is the parent's plus mutation.

### Evolution
- Mutation: Gaussian noise on brain weights and traits. The mutation rate is itself a gene, so it can evolve.
- Sexual reproduction (crossover between nearby mates) as an optional rule.
- Species and lineages are *tracked* by genome distance for analysis and display. They never influence the simulation.

### Determinism
The sim core takes a seed and a config. The same seed with the same config gives the same world, so interesting runs can be replayed, shared and saved.

## World knobs *(planned)*

All of these are editable while the sim runs:

- Plant regrowth rate, seasons, fertile and barren zones
- Metabolic cost, movement cost, brain cost
- Bite damage and meat energy yield (controls whether predation pays)
- Mutation rate and magnitude, sexual vs. asexual reproduction
- Maximum population and carrying capacity
- Terrain: walls, water, barriers that split populations
- Events: drought, plague, meteor, introduce a new creature type

## Visual layer *(planned)*

- Live canvas view, pan and zoom, speed control, pause and single-step
- Creatures coloured by genome and sized by body size; heading and vision cone shown on hover
- Overlay modes: energy, age, lineage colour, diet, food density heatmap
- Click a creature to inspect its genome, brain graph and live neuron activations; follow-cam
- Charts: population over time, mean trait values, diet distribution, species count
- Lineage tree view to see when and where a strategy branched off
- Save, load and export runs; screenshot and time-lapse capture

## Tech *(planned)*

- **TypeScript**, built with **Vite**
- **Simulation core** has no DOM dependencies and runs in a Web Worker, so it can also run headless in Node for batch experiments and tests
- **Renderer** uses Canvas 2D to start, with WebGL (instanced sprites) if creature counts demand it
- **Tests** with Vitest, including determinism and energy-conservation checks

Planned layout:

```
src/
  sim/        # world, creatures, brain, genome, energy rules (no DOM)
  render/     # canvas renderer, overlays
  ui/         # controls, inspector, charts
  worker/     # sim loop in a Web Worker
  cli/        # headless runner for experiments
tests/
```

## Implementation plan

1. **Foundation**: project scaffold, seeded RNG, config schema, world grid and food field, spatial hash.
2. **Creatures and brains**: genome, trait decoding, MLP brain, vision rays, movement physics.
3. **Energy and life cycle**: eating, metabolism, death, asexual reproduction, mutation. First evolving run.
4. **Renderer and controls**: canvas view, pause/speed, population counter, live parameter sliders.
5. **Predation and diet**: bite mechanic, diet gene, meat vs. plant efficiency. This is where predators can first appear.
6. **Analysis tools**: inspector, brain viewer, charts, lineage tracking.
7. **Richer worlds**: terrain, seasons, events, sexual reproduction, creature signals.
8. **Polish**: save/load, shareable seeds, performance pass (worker, WebGL), presets such as "Lush Eden", "Dust Bowl" and "Ice Age".
9. **Stretch**: NEAT-style brain topology evolution, recurrent brains, learning within a lifetime, multi-world islands with migration.

## Things to watch for

- **Collapse and runaway.** Most parameter sets either die out or explode into a single dominant blob. Early tuning will mostly be about finding stable ecological regimes.
- **Emergence is not guaranteed.** Predators and herds appear only if the economy rewards them, so the energy rules matter more than the brain architecture.
- **Don't smuggle in fitness.** Avoid rewards for distance travelled, food eaten and so on. Energy income is the only reward.

## Getting started

Not available yet. Build and run instructions will be added once the scaffold lands (step 1 above).

## License

To be decided.
