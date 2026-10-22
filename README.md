# ArtiLife

An artificial-life ecosystem. Creatures with small neural-net brains and heritable genomes live on a 2D map. They eat, reproduce and mutate. **There is no fitness function**: the only selection pressure is whether a creature lives long enough to have offspring.

You change the rules of the world (food supply, metabolic cost, mutation rate, terrain, disasters) and watch what evolves: grazing herds, ambush predators, scavengers, parasites, boom-and-bust cycles, and strategies nobody designed.

> **Status: early development.** Steps 1 to 7 of the [implementation plan](#implementation-plan) are done: the world and food field, creatures with genomes, neural-net brains, vision and movement, a full life cycle (eating, energy costs, death, reproduction, mutation), the NES-style pixel renderer with live controls, predation with a diet gene, and analysis tools (inspector with a live brain graph, charts, a species tree, an event log, a glyph view and colour overlays). Populations sustain themselves, evolve, and (with the default rules) split into plant eaters and hunters. Sections marked _(planned)_ are targets, not features.

## Core idea

Evolution happens because three things are true, and nothing else is imposed:

1. **Energy is scarce.** Everything a creature does costs energy: existing, moving, growing a big body, running a big brain.
2. **Creatures can make copies of themselves**, paying energy to do so.
3. **Copies are imperfect.** Genome mutations change both body and brain.

Anything that reproduces more than it dies spreads. Roles like "predator" or "herbivore" are not coded in. They are regions of genome space that evolution may or may not find, depending on the world's rules.

## How the simulation works _(planned)_

### World

- A 2D toroidal (wrap-around) map with open ground, water, rock, and fertile and barren soil. An optional **barrier** (a river or a wall running top to bottom, with a chosen number of gaps) splits the world into regions, so populations can be separated and evolve apart.
- A **food field** (a grid of plant energy) that regrows at a configurable rate. **Seasons** are optional: regrowth swings up and down over a yearly cycle, and winter can also make living costlier (`COLD COST`).
- A spatial hash for fast neighbour queries, so thousands of creatures run in real time.

### Creatures

Each creature has:

| Part            | Contents                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Genome**      | A flat array of floats: body traits plus all brain weights.                                                                                   |
| **Body traits** | Size, max speed, vision range and field of view, diet (plant↔meat efficiency), metabolic rate, colour, reproduction threshold, mutation rate. |
| **State**       | Position, heading, energy, age, generation, lineage ID.                                                                                       |
| **Brain**       | A small feed-forward neural net with a few memory neurons that carry state between ticks.                                                     |

**Brain inputs:** 5 vision rays across the field of view, each reporting nearby food, nearby obstacles (water and rock), the nearest creature, its size relative to the viewer, its diet (carnivores look toothy) and its call. Then own energy, own speed, food on the current tile, whether it was just bitten, and 2 memory neurons.

**Brain outputs:** turn, thrust, reproduce, bite and call, plus the 2 memory values for the next tick.

### Energy economy

- **Gain:** a creature eats the plants on the tile it stands on, automatically, up to an appetite that grows with its size and stops at the energy cap. When several creatures share a tile with too little food, each gets a share in proportion to its appetite. Eating other creatures is covered under Predation below.
- **Cost per tick:** staying alive (grows with size), moving (grows with speed² and size) and seeing (grows with vision range). Bigger bodies eat more but pay more, and faster or farther-seeing creatures pay for it, so no trait is free.
- **Death:** energy reaches zero, being bitten to death, or old age (configurable, can be turned off).
- **Reproduction:** the brain has a reproduce output. A creature reproduces when that output is positive, its energy is above its own threshold (a gene), and the population cap hasn't been reached. The parent pays a fixed energy cost and only part of it reaches the child, so reproduction always loses energy.

### Predation and diet

- **Diet gene** (0 to 1): a plant eater digests plants fully and meat not at all; a carnivore digests meat fully and plants at a reduced rate (the `DIET COST` rule). In between, both partly. Founders are mostly plant eaters, so hunting has to evolve.
- **Bite:** the brain has a bite output. A bite hits the nearest creature in a cone in front (reach and angle are rules). It takes energy from the victim, scaled by the biter's size and diet, so plant eaters bite weakly and only carnivores hit hard. The biter keeps part of what it took (`MEAT YIELD`) according to its diet. Every bite attempt costs energy, even a miss.
- All bites in a tick are settled together, so the result doesn't depend on the order creatures happen to be stored in. When several bites would take more than a victim has, they share what is left.
- Creatures can see how toothy others are, and feel being bitten, so both chasing and fleeing can evolve.

- In the pixel view carnivores (diet above 0.5) are drawn with horns and a red pupil, and a bite flashes at the victim.
- **How it plays out:** in my runs with the default rules, carnivores appear within the first few thousand ticks and settle at about a third to a half of the population, living off the plant eaters, and populations of 100 to 200 survived 50,000 ticks on four different seeds. Predation becomes the main cause of death. Make bites free, or meat yield high, and hunters can wipe out their prey and crash the world. Make them costly and hunters never appear. The sliders let you explore this.

### Evolution

- Mutation: Gaussian noise on brain weights and traits. The mutation rate is itself a gene, so it can evolve.
- **Sexual reproduction** is an optional rule. Two willing creatures (both ready to reproduce, close together, and with genomes similar enough) make one child between them: each gene comes from one parent or the other, then mutates. Each parent pays half the birth cost, so a child costs the same as in the asexual case. Each creature mates at most once a tick. Because mates must be similar, species can become reproductively separate.
- **Signals:** the brain has a "call" output between -1 and 1 that nearby creatures can see (one more sensor on each vision ray). Calling costs energy in proportion to its loudness, so it has to earn its keep. What, if anything, calls come to mean is left to evolution. In the pixel view a loud call shows as dots above the creature.
- **Species** are _tracked_ by genome distance for analysis and display; they never influence the simulation. All the first creatures share one species. A child stays in its parent's species until it has drifted further than a threshold from that species' founding genome; then it founds a new species, recorded as a branch of its parent's. Species counts depend a lot on the run (a handful to a couple of hundred in 20,000 ticks), and the threshold is a rule (`species.threshold`).
- **History** of the population and trait averages is sampled as it runs. When the record fills it keeps every other sample and samples half as often, so a long run still fits.
- **Events** are written to a log as they happen: population milestones and crashes, the first hunters, hunters dying out, generation milestones, season changes, a new species with a different diet, and notable extinctions.

### Determinism

The sim core takes a seed and a config. The same seed with the same config gives the same world, so interesting runs can be replayed, shared and saved.

## World knobs

All of these are editable in the side panel while the sim runs, except the "new world" group, which applies when you start a new world:

- **Food:** plant regrowth and cap, seasons (on/off, swing, year length, winter cold cost).
- **Costs:** living, moving, seeing, eating.
- **Predation:** bite power, bite cost, meat yield, diet trade-off, how weak a plant eater's bite is.
- **Life:** birth cost, maximum age, population cap, sexual reproduction (and mating range), the cost of calling.
- **Evolution:** mutation rate and size.
- **Disasters** (buttons, they happen immediately):
  - **Drought:** plants nearly stop regrowing for 1,500 ticks.
  - **Ice age:** regrowth at 40% and upkeep 40% higher, for 3,000 ticks.
  - **Bloom:** every plant instantly grows to full size.
  - **Plague:** kills two in five creatures at random.
  - **Meteor:** kills everything near a random spot and scorches the plants there.
  - **+Hunters / +Grazers:** introduce 15 hunters or 30 plant eaters with fresh random brains, as a new species.
  - Active droughts and ice ages are shown on the playfield, and each disaster is announced in the event log.
- **New world:** water, rock, soil unevenness, starting population, barrier type (none, river, wall), number of barriers and gaps in them, and the seed.

## Visual style

ArtiLife looks like an 8-bit NES game, with the information density of Dwarf Fortress. References: _The Legend of Zelda_ (NES) for the overworld and HUD, and _Dwarf Fortress_ (ASCII and tileset modes) for the dense, readable status display. Items marked _(planned)_ are not built yet.

**Rendering**

- The game draws to a 256×224 canvas (the NES resolution) and is scaled up by whole-number factors only, with `image-rendering: pixelated`. No smoothing, no sub-pixel positions, no gradients or glow.
- Every colour comes from the NES 64-colour palette.
- The world is drawn from 8×8 pixel tiles, one tile per world unit, so about 32×21 tiles are on screen at once. The simulation underneath uses continuous positions; creatures are snapped to whole pixels when drawn.

**World tiles**

- Tan speckled ground, blue water that shimmers, and brown boulders. Plants grow on the ground in three stages (sprout, tuft, berry bush), so you can see grazed-out and fertile areas.
- The map scrolls and wraps around. A minimap in the HUD shows the whole world and the part you're looking at.

**Creatures**

- 8×8 sprites, or 16×16 for big bodies (the same art at double size), with a 2-frame walk animation, mirrored left and right.
- Colour comes from the hue gene, snapped to the palette: a light body, a darker shade and a black outline. Related creatures look related.
- A sparkle when a creature is born, a puff of smoke when one dies, and a red burst when a bite lands. Carnivores get horns and a red pupil.

**HUD** (Zelda-style header)

- Minimap with creature dots and a box for the current view.
- Counters: population, births, deaths, mean generation, and the tick (or year and season when seasons are on).
- **B** slot: portrait of the followed creature. **A** slot: its size, speed, vision range, field-of-view and diet genes as five bars.
- **-LIFE-** hearts: the followed creature's energy, or the population's average when nobody is followed. Ten hearts, in half-heart steps.
- Pixel font (Press Start 2P), blue-bordered panels, black background.

**Controls**

- Click a creature to follow it (the camera tracks it and its brackets blink). Click empty ground or press `Esc` to let go.
- Drag or use the arrow keys / `WASD` to scroll. Click the minimap to jump there.
- `Space` pauses, `.` steps one tick, `[` and `]` change speed (x1 to x32; the panel shows the speed actually reached, in ticks per second). `G` switches between the tile view and the glyph view, `O` cycles the colouring.
- The side panel has sliders for the world's rules, which change the running simulation immediately: plant regrowth and cap, seasons, the cost of living, moving and seeing, eating rate, the bite (power, cost, meat yield, diet trade-off, weak bite), birth cost, lifespan, population cap, and mutation rate and size. A "new world" group (water, rock, fertility, starting population) and a seed box apply when you press GO or RND.
- Open the browser console and type `artilife` to reach the running game, e.g. `artilife.backend.sim.creatures`.

**Views and tools**

- **Glyph view:** a Dwarf Fortress-style view in the same palette: `~` water, `#` rock, `. , "` plants in three sizes, and a letter for each creature (`h` plant eater, `o` mixed feeder, `w` hunter, in capitals when big). The followed creature is highlighted.
- **Colour overlays** (`O`, or the arrows in the panel): colour creatures by energy (red to green), age (cyan to red), diet (green to red) or species; or colour the ground by how much food it holds.
- **Event ticker:** the biggest events (first hunters, a population crash, a new kind of species) scroll along the bottom of the playfield for a few seconds, like Dwarf Fortress announcements.
- **Side panel tabs:** RULES (playback, view, sliders), STATS, INSPECT and LOG.
- **STATS:** population over time (with the hunters' share in red), the average body and diet traits each scaled to their range, number of species alive, the diet distribution right now, and a **species tree** (time runs left to right; each species is a bar coloured by diet, grey once extinct, joined to the species it branched from).
- **INSPECT:** for the followed creature: its parent, generation, age, energy, species and every trait, plus a live **brain graph**. Sensors are on the left, hidden neurons in the middle and actions on the right; red lines are positive connections and blue lines negative, and the ones carrying signal this tick are bright. Neuron colour shows its activation.
- **LOG:** the event log, newest first.

**Planned**

- Save/load of runs, screenshots, and optional chiptune sound.

## Tech

- **TypeScript**, built with **Vite**.
- **Simulation core** (`src/sim/`) has no DOM dependencies, so it also runs headless in Node for batch experiments and tests. It currently runs on the browser's main thread, which is fine at a few hundred creatures; moving it to a Web Worker is an option if populations get much bigger.
- **Renderer** draws to a 256×224 Canvas 2D buffer and scales it up by integer factors (pixelated). Sprites and tiles are pixel patterns written as text in `src/render/art.ts`, coloured from the NES palette at start-up. WebGL is only needed if creature counts demand it.
- **Tests** with Vitest, including determinism and energy-conservation checks. The pure rendering and UI logic (palette, sprite art, camera, HUD helpers, controls, charts, species tree, brain graph) is unit-tested, with charts drawn onto an in-memory pixel buffer so the output can be asserted; the canvas drawing and DOM wiring are checked by hand in a browser.
- **Runtime layer:** the renderer and panel never touch the simulation directly. They read a `Scene` (flat arrays of creature data), a `CreatureDetail` for the followed creature and an `Analysis` (history, species, events), all produced by `SimHost`. That keeps drawing independent of how the simulation is run.

Layout:

```
src/
  sim/        # world, creatures, brain, genome, energy, species, history, events (no DOM)
  runtime/    # SimHost: runs a sim and publishes flat Scene/Analysis snapshots (no DOM)
  render/     # palette, pixel art, camera, canvas renderer, charts, brain view
  ui/         # control panel, input, styles
  cli/        # headless runner for experiments
  game.ts     # frame loop tying sim, renderer, panel and input together
  main.ts     # page entry point
tests/
```

## Implementation plan

1. **Foundation** _(done)_: project scaffold, seeded RNG, config schema, world grid and food field, spatial hash.
2. **Creatures and brains** _(done)_: genome, trait decoding, MLP brain, vision rays, movement physics.
3. **Energy and life cycle** _(done)_: eating, metabolism, death, asexual reproduction, mutation. First evolving run.
4. **Renderer and controls** _(done)_: pixel renderer (NES palette, tile map, creature sprites with walk frames), Zelda-style HUD with minimap, pause/speed, live parameter sliders.
5. **Predation and diet** _(done)_: bite mechanic, diet gene, meat vs. plant efficiency. This is where predators can first appear.
6. **Analysis tools** _(done)_: inspector, brain viewer, charts, lineage tracking, event log, glyph (ASCII) mode, colour overlays.
7. **Richer worlds** _(done)_: terrain barriers, seasonal cold, disasters, sexual reproduction, creature signals.
8. **Polish**: save/load, shareable seeds, performance pass (worker, WebGL), presets such as "Lush Eden", "Dust Bowl" and "Ice Age".
9. **Stretch**: NEAT-style brain topology evolution, recurrent brains, learning within a lifetime, multi-world islands with migration.

## Things to watch for

- **Collapse and runaway.** Most parameter sets either die out or explode into a single dominant blob. Early tuning will mostly be about finding stable ecological regimes.
- **Emergence is not guaranteed.** Predators and herds appear only if the economy rewards them, so the energy rules matter more than the brain architecture.
- **Don't smuggle in fitness.** Avoid rewards for distance travelled, food eaten and so on. Energy income is the only reward.

## Getting started

Requires Node 22+.

```sh
npm install
npm test          # run the unit tests
npm run typecheck # type-check without emitting
npm run dev       # start the dev server (currently shows a placeholder map view)
npm run build     # type-check and build for production
```

`npm run dev` opens the game. Click a creature to follow it, drag to scroll, and use the panel to change the world's rules while it runs (see [Controls](#visual-style)). You can also open it with `?seed=7` for a particular world, `?warmup=3000` to skip ahead 3000 ticks first, and `?paused=1`.

To watch evolution as numbers, run the headless simulator:

```sh
npm run sim -- --seed 1 --ticks 20000 --every 1000
```

It prints one row every N ticks: population, births, deaths by starvation, by being eaten and by old age, bites landed, the share of carnivores, mean generation and energy, and the mean of each trait. Change any rule with `--set`, for example `--set predation.biteCost=0.3 --set food.regrowRate=0.03`.

## License

To be decided.
