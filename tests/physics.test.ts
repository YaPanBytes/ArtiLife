import { describe, expect, it } from 'vitest';
import { OUT_THRUST, OUT_TURN } from '../src/sim/brain';
import { move } from '../src/sim/physics';
import { Terrain } from '../src/sim/world';
import { emptyWorld, makeCreature } from './helpers';

describe('move', () => {
  const drive = (c: ReturnType<typeof makeCreature>, turn: number, thrust: number) => {
    c.outputs[OUT_TURN] = turn;
    c.outputs[OUT_THRUST] = thrust;
  };

  it('accelerates towards the commanded speed and never past it', () => {
    const { world, config } = emptyWorld();
    const c = makeCreature(10, 10, 0);
    drive(c, 0, 1);
    let last = 0;
    for (let i = 0; i < 60; i++) {
      move(c, world, config);
      expect(c.speed).toBeGreaterThanOrEqual(last);
      expect(c.speed).toBeLessThanOrEqual(c.traits.maxSpeed + 1e-9);
      last = c.speed;
    }
    expect(c.speed).toBeCloseTo(c.traits.maxSpeed, 3);
    expect(c.x).toBeGreaterThan(10);
    expect(c.y).toBeCloseTo(10, 9);
  });

  it('stands still with thrust -1', () => {
    const { world, config } = emptyWorld();
    const c = makeCreature(10, 10, 0);
    drive(c, 0, -1);
    for (let i = 0; i < 10; i++) move(c, world, config);
    expect(c.x).toBe(10);
    expect(c.speed).toBe(0);
  });

  it('turns by at most maxTurnRate per tick, and the heading stays wrapped', () => {
    const { world, config } = emptyWorld();
    const c = makeCreature(10, 10, 0);
    drive(c, 1, -1);
    move(c, world, config);
    expect(c.heading).toBeCloseTo(config.creatures.maxTurnRate, 9);
    for (let i = 0; i < 100; i++) move(c, world, config);
    expect(c.heading).toBeGreaterThanOrEqual(-Math.PI);
    expect(c.heading).toBeLessThan(Math.PI);
  });

  it('wraps around the map edge', () => {
    const { world, config } = emptyWorld();
    const c = makeCreature(world.width - 0.05, 10, 0);
    c.speed = 0.2;
    drive(c, 0, 1);
    move(c, world, config);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.x).toBeLessThan(0.5);
  });

  it('is stopped by water and rock', () => {
    const { world, config } = emptyWorld();
    world.terrain[world.tileIndex(12, 10)] = Terrain.Water;
    const c = makeCreature(11.9, 10.5, 0);
    drive(c, 0, 1);
    for (let i = 0; i < 20; i++) move(c, world, config);
    expect(Math.floor(c.x)).toBe(11);
    expect(c.speed).toBe(0);
  });

  it('slides along a wall instead of sticking to it', () => {
    const { world, config } = emptyWorld();
    for (let y = 0; y < world.height; y++) world.terrain[world.tileIndex(12, y)] = Terrain.Rock;
    // Heading diagonally into a vertical wall: x is blocked, y keeps moving.
    const c = makeCreature(11.9, 10.5, Math.PI / 4);
    drive(c, 0, 1);
    for (let i = 0; i < 20; i++) move(c, world, config);
    expect(Math.floor(c.x)).toBe(11);
    expect(c.y).toBeGreaterThan(10.5);
  });

  it('does not cut through the corner of a single rock tile', () => {
    const { world, config } = emptyWorld();
    world.terrain[world.tileIndex(12, 11)] = Terrain.Rock;
    // Just short of the corner, heading diagonally at the rock.
    const c = makeCreature(11.95, 10.95, Math.PI / 4);
    drive(c, 0, 1);
    for (let i = 0; i < 40; i++) {
      move(c, world, config);
      expect(world.isWalkable(c.x, c.y)).toBe(true);
    }
  });
});
