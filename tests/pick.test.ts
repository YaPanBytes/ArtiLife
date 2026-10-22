import { describe, expect, it } from 'vitest';
import { pickCreature } from '../src/ui/pick';
import { emptyWorld, makeCreature } from './helpers';

describe('pickCreature', () => {
  const { world } = emptyWorld();

  it('picks the nearest creature within the radius', () => {
    const near = makeCreature(10, 10);
    const far = makeCreature(12, 10);
    expect(pickCreature([far, near], world, 10.5, 10, 1.5)).toBe(near);
  });

  it('returns null when nothing is close enough, or there are no creatures', () => {
    expect(pickCreature([makeCreature(10, 10)], world, 20, 20, 1.5)).toBeNull();
    expect(pickCreature([], world, 5, 5, 1.5)).toBeNull();
  });

  it('picks across the map seam', () => {
    const c = makeCreature(world.width - 0.5, 10);
    expect(pickCreature([c], world, 0.5, 10, 1.5)).toBe(c);
  });
});
