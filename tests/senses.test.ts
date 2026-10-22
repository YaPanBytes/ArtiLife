import { describe, expect, it } from 'vitest';
import { RAY_CHANNELS, RAY_COUNT, SENSE_INPUT_COUNT, sense } from '../src/sim/senses';
import { SpatialHash } from '../src/sim/spatial-hash';
import { Terrain } from '../src/sim/world';
import { emptyWorld, makeCreature } from './helpers';

// Channel offsets within a ray, and the centre ray.
const FOOD = 0;
const OBSTACLE = 1;
const CREATURE = 2;
const SIZE = 3;
const MID = Math.floor(RAY_COUNT / 2);
const at = (ray: number, channel: number) => ray * RAY_CHANNELS + channel;

function look(
  world: ReturnType<typeof emptyWorld>['world'],
  config: ReturnType<typeof emptyWorld>['config'],
  subject: ReturnType<typeof makeCreature>,
  others: ReturnType<typeof makeCreature>[] = [],
) {
  const all = [subject, ...others];
  const hash = new SpatialHash(world.width, world.height, 10);
  hash.build(
    all.map((c) => c.x),
    all.map((c) => c.y),
    all.length,
  );
  sense(subject, world, all, hash, config, []);
  return subject.inputs;
}

describe('sense', () => {
  it('sees nothing in an empty world', () => {
    const { world, config } = emptyWorld();
    const inputs = look(world, config, makeCreature(10, 10, 0, {}, 0));
    expect(Array.from(inputs.subarray(0, SENSE_INPUT_COUNT)).every((v) => v === 0)).toBe(true);
  });

  it('sees food ahead, and more of it when it is closer', () => {
    const { world, config } = emptyWorld();
    const subject = makeCreature(10.5, 10.5, 0); // looking along +x, range 6
    world.food[world.tileIndex(12, 10)] = config.food.maxPerTile; // 2 tiles ahead
    const near = look(world, config, subject)[at(MID, FOOD)];
    world.food.fill(0);
    world.food[world.tileIndex(15, 10)] = config.food.maxPerTile; // 5 tiles ahead
    const far = look(world, config, subject)[at(MID, FOOD)];
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
  });

  it('does not see food behind it', () => {
    const { world, config } = emptyWorld();
    const subject = makeCreature(10.5, 10.5, 0, { visionFov: 0.1 });
    world.food[world.tileIndex(8, 10)] = config.food.maxPerTile;
    const inputs = look(world, config, subject);
    for (let k = 0; k < RAY_COUNT; k++) expect(inputs[at(k, FOOD)]).toBe(0);
  });

  it('sees an obstacle ahead and cannot see food behind it', () => {
    const { world, config } = emptyWorld();
    const subject = makeCreature(10.5, 10.5, 0);
    world.terrain[world.tileIndex(12, 10)] = Terrain.Rock;
    world.food[world.tileIndex(14, 10)] = config.food.maxPerTile;
    const inputs = look(world, config, subject);
    expect(inputs[at(MID, OBSTACLE)]).toBeCloseTo(1 - 2 / 6, 5);
    expect(inputs[at(MID, FOOD)]).toBe(0);
  });

  it('sees creatures by bearing, with relative size', () => {
    const { world, config } = emptyWorld();
    const subject = makeCreature(10, 10, 0, { size: 0 }); // size 0.5
    const big = makeCreature(13, 10, 0, { size: 1 }); // size 2, straight ahead
    const inputs = look(world, config, subject, [big]);
    expect(inputs[at(MID, CREATURE)]).toBeCloseTo(1 - 3 / 6, 5);
    expect(inputs[at(MID, SIZE)]).toBeCloseTo((2 - 0.5) / (2 + 0.5), 5);
    expect(inputs[at(MID - 1, CREATURE)]).toBe(0);
  });

  it('puts a creature to the right of its heading on a higher ray than one on the left', () => {
    const { world, config } = emptyWorld();
    // +y is "right" when heading along +x (angles grow clockwise on screen).
    const subject = makeCreature(10, 10, 0, { visionFov: 1 });
    const rightSide = look(world, config, subject, [makeCreature(12, 12.5, 0)]);
    const rightRay = Array.from(
      { length: RAY_COUNT },
      (_, k) => rightSide[at(k, CREATURE)],
    ).findIndex((v) => v > 0);
    const leftSide = look(world, config, subject, [makeCreature(12, 7.5, 0)]);
    const leftRay = Array.from(
      { length: RAY_COUNT },
      (_, k) => leftSide[at(k, CREATURE)],
    ).findIndex((v) => v > 0);
    expect(rightRay).toBeGreaterThan(MID);
    expect(leftRay).toBeLessThan(MID);
  });

  it('ignores creatures beyond its range and keeps only the nearest per ray', () => {
    const { world, config } = emptyWorld();
    const subject = makeCreature(10, 10, 0);
    expect(look(world, config, subject, [makeCreature(20, 10)])[at(MID, CREATURE)]).toBe(0);
    const both = look(world, config, subject, [makeCreature(15, 10), makeCreature(12, 10)]);
    expect(both[at(MID, CREATURE)]).toBeCloseTo(1 - 2 / 6, 5);
  });

  it('sees creatures across the map seam', () => {
    const { world, config } = emptyWorld();
    const subject = makeCreature(0.5, 10, 0, {}); // heading +x
    const behindSeam = makeCreature(world.width - 0.5, 10, 0);
    const west = makeCreature(0.5, 10, Math.PI); // heading -x, so the seam is straight ahead
    expect(look(world, config, subject, [behindSeam])[at(MID, CREATURE)]).toBe(0);
    expect(look(world, config, west, [behindSeam])[at(MID, CREATURE)]).toBeGreaterThan(0);
  });

  it('reports own energy, speed and the food underfoot', () => {
    const { world, config } = emptyWorld();
    const subject = makeCreature(10.5, 10.5, 0, {}, 25);
    subject.speed = subject.traits.maxSpeed / 2;
    world.food[world.tileIndex(10, 10)] = config.food.maxPerTile / 2;
    const inputs = look(world, config, subject);
    const self = RAY_COUNT * RAY_CHANNELS;
    expect(inputs[self]).toBeCloseTo(25 / config.creatures.maxEnergy, 5);
    expect(inputs[self + 1]).toBeCloseTo(0.5, 5);
    expect(inputs[self + 2]).toBeCloseTo(0.5, 5);
  });
});
