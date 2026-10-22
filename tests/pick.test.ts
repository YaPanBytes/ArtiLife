import { describe, expect, it } from 'vitest';
import { Scene } from '../src/runtime/types';
import { pickCreature } from '../src/ui/pick';

const world = { width: 32, height: 32, terrain: new Uint8Array(32 * 32) };

/** A scene with creatures at the given positions, with ids 10, 11, ... */
function sceneAt(...positions: [number, number][]): Scene {
  const scene = new Scene();
  scene.ensureCapacity(positions.length);
  scene.count = positions.length;
  positions.forEach(([x, y], i) => {
    scene.id[i] = 10 + i;
    scene.x[i] = x;
    scene.y[i] = y;
  });
  return scene;
}

describe('pickCreature', () => {
  it('picks the nearest creature within the radius', () => {
    const scene = sceneAt([12, 10], [10, 10]);
    expect(pickCreature(scene, world, 10.5, 10, 1.5)).toBe(11);
  });

  it('returns null when nothing is close enough, or there are no creatures', () => {
    expect(pickCreature(sceneAt([10, 10]), world, 20, 20, 1.5)).toBeNull();
    expect(pickCreature(sceneAt(), world, 5, 5, 1.5)).toBeNull();
  });

  it('picks across the map seam', () => {
    const scene = sceneAt([world.width - 0.5, 10]);
    expect(pickCreature(scene, world, 0.5, 10, 1.5)).toBe(10);
  });
});
