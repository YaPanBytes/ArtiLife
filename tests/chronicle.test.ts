import { describe, expect, it } from 'vitest';
import { Chronicler } from '../src/sim/chronicle';
import type { Simulation } from '../src/sim/simulation';
import { lifeSim, makeCreature } from './helpers';

const crowd = (sim: Simulation, n: number, genes = {}) => {
  sim.creatures.length = 0;
  for (let i = 0; i < n; i++)
    sim.creatures.push(makeCreature(i % 30, Math.floor(i / 30), 0, genes));
};
const texts = (sim: Simulation) => sim.events.events.map((e) => e.text);

describe('Chronicler', () => {
  it('announces each population milestone once', () => {
    const sim = lifeSim();
    const chronicle = new Chronicler();
    crowd(sim, 120);
    chronicle.update(sim);
    expect(texts(sim)).toEqual(['POPULATION REACHES 50', 'POPULATION REACHES 100']);
    chronicle.update(sim);
    expect(sim.events.events.length).toBe(2);
  });

  it('reports a crash and a recovery, and an extinction', () => {
    const sim = lifeSim();
    const chronicle = new Chronicler();
    crowd(sim, 300);
    chronicle.update(sim);
    crowd(sim, 40);
    sim.tick = 1;
    chronicle.update(sim);
    const crash = sim.events.events.find((e) => e.text.startsWith('POPULATION CRASHES'));
    expect(crash).toMatchObject({
      kind: 'population',
      major: true,
      text: 'POPULATION CRASHES TO 40',
    });
    crowd(sim, 250);
    sim.tick = 2;
    chronicle.update(sim);
    expect(texts(sim)).toContain('POPULATION RECOVERS');
    crowd(sim, 0);
    sim.tick = 3;
    chronicle.update(sim);
    expect(sim.events.events.at(-1)).toMatchObject({ kind: 'extinction', major: true });
    chronicle.update(sim);
    expect(texts(sim).filter((t) => t.includes('DIED OUT')).length).toBe(1);
  });

  it('notices the first hunters, and when they are gone', () => {
    const sim = lifeSim();
    const chronicle = new Chronicler();
    crowd(sim, 10);
    chronicle.update(sim);
    expect(texts(sim)).not.toContain('THE FIRST HUNTERS APPEAR');
    crowd(sim, 10, { diet: 1 });
    sim.tick = 25;
    chronicle.update(sim);
    expect(texts(sim)).toContain('THE FIRST HUNTERS APPEAR');
    sim.tick = 50;
    chronicle.update(sim);
    expect(texts(sim).filter((t) => t === 'THE FIRST HUNTERS APPEAR').length).toBe(1);
    crowd(sim, 10);
    sim.tick = 75;
    chronicle.update(sim);
    expect(texts(sim)).toContain('THE HUNTERS HAVE DIED OUT');
  });

  it('marks generations as they are reached', () => {
    const sim = lifeSim();
    const chronicle = new Chronicler();
    crowd(sim, 3);
    chronicle.update(sim);
    expect(texts(sim).some((t) => t.startsWith('GENERATION'))).toBe(false);
    Object.defineProperty(sim.creatures[0], 'generation', { value: 30 });
    sim.tick = 25;
    chronicle.update(sim);
    expect(texts(sim).filter((t) => t.startsWith('GENERATION'))).toEqual([
      'GENERATION 10 REACHED',
      'GENERATION 25 REACHED',
    ]);
  });

  it('says when the season turns, but only when seasons are on', () => {
    const off = lifeSim();
    const offChron = new Chronicler();
    for (let t = 0; t < 600; t += 10) {
      off.tick = t;
      offChron.update(off);
    }
    expect(texts(off).some((t) => t.includes('BEGINS'))).toBe(false);

    const on = lifeSim({ food: { seasons: { enabled: true, lengthTicks: 400 } } });
    const chronicle = new Chronicler();
    for (const t of [0, 50, 100, 250, 399, 400]) {
      on.tick = t;
      chronicle.update(on);
    }
    expect(on.events.events.filter((e) => e.kind === 'season').map((e) => e.text)).toEqual([
      'SUMMER OF YEAR 1 BEGINS',
      'AUTUMN OF YEAR 1 BEGINS',
      'WINTER OF YEAR 1 BEGINS',
      'SPRING OF YEAR 2 BEGINS',
    ]);
  });

  it('words speciation and extinction messages', () => {
    expect(Chronicler.speciationText(7, 3, 0.9)).toBe('NEW HUNTER SPECIES 7 (FROM 3)');
    expect(Chronicler.extinctionText(7, 40)).toBe('SPECIES 7 IS EXTINCT (PEAK 40)');
    expect(Chronicler.isNotable(14)).toBe(false);
    expect(Chronicler.isNotable(15)).toBe(true);
  });
});

describe('EventLog', () => {
  it('keeps only the newest events, bumps its version and calls the listener', () => {
    const sim = lifeSim();
    const heard: string[] = [];
    sim.events.onEvent = (e) => heard.push(e.text);
    for (let i = 0; i < 305; i++) sim.events.push(i, 'info', `E${i}`);
    expect(sim.events.events.length).toBe(300);
    expect(sim.events.events[0].text).toBe('E5');
    expect(heard.length).toBe(305);
    expect(sim.events.version).toBe(305);
    sim.events.clear();
    expect(sim.events.events.length).toBe(0);
  });
});
