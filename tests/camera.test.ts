import { describe, expect, it } from 'vitest';
import { Camera, wrapDelta } from '../src/render/camera';

describe('wrapDelta', () => {
  it('takes the short way round a ring', () => {
    expect(wrapDelta(10, 20, 100)).toBe(10);
    expect(wrapDelta(95, 5, 100)).toBe(10);
    expect(wrapDelta(5, 95, 100)).toBe(-10);
    expect(wrapDelta(0, 50, 100)).toBe(50);
    expect(wrapDelta(30, 30, 100)).toBe(0);
  });
});

describe('Camera', () => {
  // A 64x64-tile world is 512x512 pixels; the view is 100x80.
  const make = () => new Camera(64, 64, 100, 80);

  it('centres on a world position', () => {
    const cam = make();
    cam.centerOn(300, 200);
    expect(cam.centerX).toBeCloseTo(300);
    expect(cam.centerY).toBeCloseTo(200);
    expect(cam.toScreen(300, 200)).toEqual([50, 40]);
  });

  it('wraps its position when panned past an edge', () => {
    const cam = make();
    cam.pan(-10, -10);
    expect(cam.x).toBe(502);
    expect(cam.y).toBe(502);
    cam.pan(20, 20);
    expect(cam.x).toBe(10);
  });

  it('shows things across the seam next to the view', () => {
    const cam = make();
    cam.centerOn(5, 5);
    // A thing at world x=507 is 10 pixels to the left of x=5, across the seam.
    const [sx] = cam.toScreen(507, 5);
    expect(sx).toBeCloseTo(50 - 10);
  });

  it('converts screen to world and back', () => {
    const cam = make();
    cam.centerOn(480, 20);
    for (const [wx, wy] of [
      [480, 20],
      [10, 500],
      [450, 60],
    ]) {
      const [sx, sy] = cam.toScreen(wx, wy);
      const [bx, by] = cam.toWorld(sx, sy);
      expect(bx).toBeCloseTo(wx);
      expect(by).toBeCloseTo(wy);
    }
  });

  it('follows a target by the shortest path, across the seam, and arrives', () => {
    const cam = make();
    cam.centerOn(500, 256);
    const before = cam.centerX;
    cam.follow(8, 256, 0.5);
    // Target is 20 px away going right through the seam: the camera should move right, not 492 px left.
    expect((cam.centerX - before + 512) % 512).toBeLessThan(20);
    for (let i = 0; i < 60; i++) cam.follow(8, 256, 0.5);
    expect(wrapDelta(cam.centerX, 8, 512)).toBeCloseTo(0, 3);
  });
});
