import type { SimConfig } from './config';

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
