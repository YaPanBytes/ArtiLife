/** One thing measured over time. */
export const HISTORY_SERIES = [
  'population',
  'meanEnergy',
  'species',
  'carnivores',
  'size',
  'speed',
  'vision',
  'fov',
  'diet',
] as const;

export type SeriesName = (typeof HISTORY_SERIES)[number];
export const DIET_BINS = 10;

export interface HistoryData {
  /** Tick of each sample. */
  ticks: Float64Array;
  /** Number of valid samples. */
  length: number;
  series: Record<SeriesName, Float32Array>;
  version: number;
}

/** A history in plain numbers, for saving. */
export interface HistoryState {
  interval: number;
  version: number;
  ticks: number[];
  series: Record<SeriesName, number[]>;
}

/** What `History.record` is given: one sample of each series. */
export type Sample = Record<SeriesName, number>;

/**
 * A fixed-size record of how the world changed. When it fills up it keeps every
 * other sample and samples half as often, so a long run still fits.
 */
export class History {
  private ticks: Float64Array;
  private readonly series: Record<SeriesName, Float32Array>;
  private length = 0;
  /** Ticks between samples. Doubles each time the history fills up. */
  interval: number;
  version = 0;

  constructor(
    private readonly capacity = 400,
    interval = 25,
  ) {
    this.interval = interval;
    this.ticks = new Float64Array(capacity);
    this.series = Object.fromEntries(
      HISTORY_SERIES.map((name) => [name, new Float32Array(capacity)]),
    ) as Record<SeriesName, Float32Array>;
  }

  /** Is a sample due at this tick? */
  due(tick: number): boolean {
    return tick % this.interval === 0;
  }

  record(tick: number, sample: Sample): void {
    if (this.length === this.capacity) this.thin();
    this.ticks[this.length] = tick;
    for (const name of HISTORY_SERIES) this.series[name][this.length] = sample[name];
    this.length++;
    this.version++;
  }

  private thin(): void {
    const half = this.capacity >> 1;
    for (let i = 0; i < half; i++) {
      this.ticks[i] = this.ticks[i * 2];
      for (const name of HISTORY_SERIES) this.series[name][i] = this.series[name][i * 2];
    }
    this.length = half;
    this.interval *= 2;
  }

  /** A view of the samples so far. The arrays are shared, not copied. */
  data(): HistoryData {
    return {
      ticks: this.ticks,
      length: this.length,
      series: this.series,
      version: this.version,
    };
  }

  /** Everything needed to rebuild this history later. */
  getState(): HistoryState {
    return {
      interval: this.interval,
      version: this.version,
      ticks: Array.from(this.ticks.subarray(0, this.length)),
      series: Object.fromEntries(
        HISTORY_SERIES.map((name) => [
          name,
          Array.from(this.series[name].subarray(0, this.length)),
        ]),
      ) as Record<SeriesName, number[]>,
    };
  }

  setState(state: HistoryState): void {
    this.interval = state.interval;
    this.version = state.version;
    this.length = Math.min(state.ticks.length, this.capacity);
    this.ticks.set(state.ticks.slice(0, this.length));
    for (const name of HISTORY_SERIES)
      this.series[name].set(state.series[name].slice(0, this.length));
  }

  clear(): void {
    this.length = 0;
    this.version++;
  }
}
