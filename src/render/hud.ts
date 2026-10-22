import type { SimConfig } from '../sim/config';
import { clamp } from '../sim/math';

export type HeartKind = 'full' | 'half' | 'empty';

export const HEART_COUNT = 10;

/** Ten hearts showing a 0-1 fraction in half-heart steps. Anything alive shows at least half a heart. */
export function heartsFor(fraction: number): HeartKind[] {
  let halves = Math.round(clamp(fraction, 0, 1) * HEART_COUNT * 2);
  if (halves === 0 && fraction > 0) halves = 1;
  return Array.from({ length: HEART_COUNT }, (_, i) => {
    const left = halves - i * 2;
    return left >= 2 ? 'full' : left === 1 ? 'half' : 'empty';
  });
}

/** Zero-padded number, capped so it never gets wider than `digits`. */
export function formatCount(n: number, digits: number): string {
  const capped = Math.min(Math.max(0, Math.floor(n)), 10 ** digits - 1);
  return String(capped).padStart(digits, '0');
}

export interface SeasonInfo {
  year: number;
  name: 'SPRING' | 'SUMMER' | 'AUTUMN' | 'WINTER';
}

const SEASONS: SeasonInfo['name'][] = ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'];

/** Year and season at a tick, or null when the world has no seasons. */
export function seasonInfo(tick: number, config: SimConfig): SeasonInfo | null {
  const { enabled, lengthTicks } = config.food.seasons;
  if (!enabled) return null;
  const year = Math.floor(tick / lengthTicks) + 1;
  const phase = (tick % lengthTicks) / lengthTicks;
  return { year, name: SEASONS[Math.min(3, Math.floor(phase * 4))] };
}
