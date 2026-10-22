export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Wrap an angle into [-PI, PI). */
export function wrapAngle(a: number): number {
  const twoPi = 2 * Math.PI;
  return a - twoPi * Math.floor((a + Math.PI) / twoPi);
}
