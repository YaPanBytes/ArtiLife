export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Wrap an angle into [-PI, PI). */
export function wrapAngle(a: number): number {
  const twoPi = 2 * Math.PI;
  return a - twoPi * Math.floor((a + Math.PI) / twoPi);
}

// Coefficients of a rational approximation to tanh that is good to about 2e-7 (float precision)
// over the whole line, from the one Eigen uses for floats.
const TANH_LIMIT = 7.99881172180176;
const A1 = 4.89352455891786e-3;
const A3 = 6.37261928875436e-4;
const A5 = 1.48572235717979e-5;
const A7 = 5.12229709037114e-8;
const A9 = -8.60467152213735e-11;
const A11 = 2.00018790482477e-13;
const A13 = -2.76076847742355e-16;
const B0 = 4.89352518554385e-3;
const B2 = 2.268434632439e-3;
const B4 = 1.18534705686654e-4;
const B6 = 1.19825839466702e-6;

/**
 * tanh to within 2e-7, several times faster than `Math.tanh`. Brains evaluate it for every
 * neuron of every creature every tick, so it is the single biggest cost of thinking; and unlike
 * `Math.tanh`, whose last digits differ between JavaScript engines, it gives the same answer everywhere.
 */
export function tanh(x: number): number {
  if (x > TANH_LIMIT) x = TANH_LIMIT;
  else if (x < -TANH_LIMIT) x = -TANH_LIMIT;
  const x2 = x * x;
  const p = x * (A1 + x2 * (A3 + x2 * (A5 + x2 * (A7 + x2 * (A9 + x2 * (A11 + x2 * A13))))));
  const q = B0 + x2 * (B2 + x2 * (B4 + x2 * B6));
  return p / q;
}
