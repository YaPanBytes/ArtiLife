import { describe, expect, it } from 'vitest';
import { DIET_BINS, HISTORY_SERIES, History, type Sample } from '../src/sim/history';
import { Simulation } from '../src/sim/simulation';

const sample = (n: number): Sample =>
  Object.fromEntries(HISTORY_SERIES.map((name, i) => [name, n * 10 + i])) as Sample;

describe('History', () => {
  it('records samples in order and reports its length', () => {
    const h = new History(10, 5);
    h.record(5, sample(1));
    h.record(10, sample(2));
    const d = h.data();
    expect(d.length).toBe(2);
    expect(Array.from(d.ticks.subarray(0, 2))).toEqual([5, 10]);
    expect(d.series.population[0]).toBe(10);
    expect(d.series.population[1]).toBe(20);
    expect(d.series.meanEnergy[1]).toBe(21);
  });

  it('says when a sample is due', () => {
    const h = new History(10, 25);
    expect(h.due(0)).toBe(true);
    expect(h.due(25)).toBe(true);
    expect(h.due(30)).toBe(false);
  });

  it('thins itself when full, keeping the whole timeline and sampling half as often', () => {
    const h = new History(8, 10);
    for (let i = 1; i <= 8; i++) h.record(i * 10, sample(i));
    expect(h.data().length).toBe(8);
    h.record(90, sample(9));
    const d = h.data();
    expect(d.length).toBe(5);
    expect(h.interval).toBe(20);
    expect(Array.from(d.ticks.subarray(0, 5))).toEqual([10, 30, 50, 70, 90]);
    expect(d.series.population[4]).toBe(90);
  });

  it('never exceeds its capacity over a long run', () => {
    const h = new History(16, 1);
    for (let t = 1; t <= 1000; t++) if (h.due(t)) h.record(t, sample(t));
    expect(h.data().length).toBeLessThanOrEqual(16);
    const ticks = Array.from(h.data().ticks.subarray(0, h.data().length));
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
    expect(ticks[ticks.length - 1]).toBeGreaterThan(900);
  });

  it('bumps its version on every change', () => {
    const h = new History(4, 1);
    const v = h.version;
    h.record(1, sample(1));
    expect(h.version).toBeGreaterThan(v);
    const v2 = h.version;
    h.clear();
    expect(h.data().length).toBe(0);
    expect(h.version).toBeGreaterThan(v2);
  });
});

describe('Simulation history', () => {
  it('samples the population as it runs', () => {
    const sim = new Simulation({ seed: 1, creatures: { initialCount: 50 } });
    for (let t = 0; t < 300; t++) sim.step();
    const d = sim.history.data();
    expect(d.length).toBe(300 / 25);
    expect(d.series.population[d.length - 1]).toBe(sim.creatures.length);
    for (const name of HISTORY_SERIES) {
      for (let i = 0; i < d.length; i++) expect(Number.isFinite(d.series[name][i])).toBe(true);
    }
    const last = d.length - 1;
    expect(d.series.carnivores[last]).toBeGreaterThanOrEqual(0);
    expect(d.series.carnivores[last]).toBeLessThanOrEqual(1);
  });

  it('counts creatures into diet bins', () => {
    const sim = new Simulation({ seed: 1, creatures: { initialCount: 80 } });
    const bins = sim.dietHistogram();
    expect(bins.length).toBe(DIET_BINS);
    expect(bins.reduce((a, b) => a + b, 0)).toBe(80);
    // Founders are mostly plant eaters.
    expect(bins[0]).toBeGreaterThan(bins[DIET_BINS - 1]);
  });
});
