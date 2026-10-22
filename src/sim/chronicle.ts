import type { Simulation } from './simulation';
import { seasonInfo } from './season';
import { dietClass } from './species';

const POPULATION_MILESTONES = [50, 100, 200, 300, 500, 750, 1000, 1500];
const GENERATION_MILESTONES = [10, 25, 50, 100, 200, 400, 800, 1600, 3200];
/** Creatures with at least this diet count as hunters. */
const HUNTER_DIET = 0.6;
/** Checks that need a pass over every creature happen this often (ticks). */
const SCAN_EVERY = 25;
const CRASH_BELOW = 0.35;
const RECOVER_ABOVE = 0.6;
/** Species smaller than this at their peak aren't worth announcing when they die out. */
const NOTABLE_PEAK = 15;
/** At most one new-species announcement per this many ticks. */
export const SPECIATION_ANNOUNCE_GAP = 1000;

/** What the chronicler remembers, so a saved run carries on without repeating announcements. */
export interface ChronicleState {
  populationMilestone: number;
  generationMilestone: number;
  recentPeak: number;
  crashed: boolean;
  extinct: boolean;
  huntersSeen: boolean;
  huntersAlive: boolean;
  season: string | null;
}

/** Watches a simulation and writes the noteworthy moments to its event log. */
export class Chronicler {
  private populationMilestone = 0;
  private generationMilestone = 0;
  private recentPeak = 0;
  private crashed = false;
  private extinct = false;
  private huntersSeen = false;
  private huntersAlive = false;
  private season: string | null = null;

  getState(): ChronicleState {
    return {
      populationMilestone: this.populationMilestone,
      generationMilestone: this.generationMilestone,
      recentPeak: this.recentPeak,
      crashed: this.crashed,
      extinct: this.extinct,
      huntersSeen: this.huntersSeen,
      huntersAlive: this.huntersAlive,
      season: this.season,
    };
  }

  setState(s: ChronicleState): void {
    Object.assign(this, s);
  }

  update(sim: Simulation): void {
    const { tick, events, creatures } = sim;
    const population = creatures.length;

    while (
      this.populationMilestone < POPULATION_MILESTONES.length &&
      population >= POPULATION_MILESTONES[this.populationMilestone]
    ) {
      events.push(
        tick,
        'population',
        `POPULATION REACHES ${POPULATION_MILESTONES[this.populationMilestone]}`,
      );
      this.populationMilestone++;
    }

    this.recentPeak = Math.max(population, this.recentPeak * 0.9995);
    if (
      !this.crashed &&
      this.recentPeak >= 60 &&
      population < this.recentPeak * CRASH_BELOW &&
      population > 0
    ) {
      this.crashed = true;
      events.push(tick, 'population', `POPULATION CRASHES TO ${population}`, true);
    } else if (this.crashed && population > this.recentPeak * RECOVER_ABOVE) {
      this.crashed = false;
      events.push(tick, 'population', 'POPULATION RECOVERS');
    }
    if (population === 0 && !this.extinct && tick > 0) {
      this.extinct = true;
      events.push(tick, 'extinction', 'ALL CREATURES HAVE DIED OUT', true);
    }

    const info = seasonInfo(tick, sim.config);
    const season = info ? `${info.name} ${info.year}` : null;
    if (season !== this.season) {
      if (info && this.season !== null)
        events.push(tick, 'season', `${info.name} OF YEAR ${info.year} BEGINS`);
      this.season = season;
    }

    if (tick % SCAN_EVERY === 0) this.scan(sim);
  }

  private scan(sim: Simulation): void {
    const { tick, events, creatures } = sim;
    let hunters = 0;
    let maxGeneration = 0;
    for (const c of creatures) {
      if (c.traits.diet >= HUNTER_DIET) hunters++;
      if (c.generation > maxGeneration) maxGeneration = c.generation;
    }
    if (hunters > 0 && !this.huntersSeen) {
      this.huntersSeen = true;
      events.push(tick, 'predator', 'THE FIRST HUNTERS APPEAR', true);
    }
    if (hunters > 0) this.huntersAlive = true;
    else if (this.huntersAlive) {
      this.huntersAlive = false;
      events.push(tick, 'predator', 'THE HUNTERS HAVE DIED OUT', true);
    }
    while (
      this.generationMilestone < GENERATION_MILESTONES.length &&
      maxGeneration >= GENERATION_MILESTONES[this.generationMilestone]
    ) {
      events.push(
        tick,
        'generation',
        `GENERATION ${GENERATION_MILESTONES[this.generationMilestone]} REACHED`,
      );
      this.generationMilestone++;
    }
  }

  /** Text for a new species, used when it branches off. */
  static speciationText(id: number, parentId: number, diet: number): string {
    return `NEW ${dietClass(diet)} SPECIES ${id} (FROM ${parentId})`;
  }

  static extinctionText(id: number, peak: number): string {
    return `SPECIES ${id} IS EXTINCT (PEAK ${peak})`;
  }

  static isNotable(peak: number): boolean {
    return peak >= NOTABLE_PEAK;
  }
}
