/** The few parts of the Web Audio API we use, so a stand-in can be used in tests. */
export interface AudioParamLike {
  setValueAtTime(value: number, time: number): void;
  linearRampToValueAtTime(value: number, time: number): void;
}
export interface AudioNodeLike {
  connect(destination: unknown): unknown;
}
export interface OscillatorLike extends AudioNodeLike {
  type: string;
  frequency: AudioParamLike;
  start(time: number): void;
  stop(time: number): void;
}
export interface GainLike extends AudioNodeLike {
  gain: AudioParamLike;
}
export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: unknown;
  readonly state?: string;
  resume?(): Promise<void>;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
}

export type Sound = 'birth' | 'death' | 'hit' | 'event' | 'disaster';

interface Note {
  /** Start and end pitch in Hz. */
  from: number;
  to: number;
  /** Seconds from the start of the sound. */
  at: number;
  length: number;
  wave: 'square' | 'triangle' | 'sawtooth';
  volume: number;
}

/** Each sound is a few short notes, in the spirit of an 8-bit console. */
const SOUNDS: Record<Sound, { notes: Note[]; minGapMs: number }> = {
  birth: {
    minGapMs: 90,
    notes: [
      { from: 660, to: 660, at: 0, length: 0.05, wave: 'square', volume: 0.04 },
      { from: 990, to: 990, at: 0.05, length: 0.07, wave: 'square', volume: 0.04 },
    ],
  },
  death: {
    minGapMs: 120,
    notes: [{ from: 220, to: 90, at: 0, length: 0.14, wave: 'triangle', volume: 0.07 }],
  },
  hit: {
    minGapMs: 70,
    notes: [{ from: 160, to: 70, at: 0, length: 0.06, wave: 'sawtooth', volume: 0.04 }],
  },
  event: {
    minGapMs: 400,
    notes: [
      { from: 523, to: 523, at: 0, length: 0.09, wave: 'square', volume: 0.05 },
      { from: 659, to: 659, at: 0.09, length: 0.09, wave: 'square', volume: 0.05 },
      { from: 784, to: 784, at: 0.18, length: 0.16, wave: 'square', volume: 0.05 },
    ],
  },
  disaster: {
    minGapMs: 400,
    notes: [
      { from: 196, to: 98, at: 0, length: 0.3, wave: 'sawtooth', volume: 0.07 },
      { from: 147, to: 73, at: 0.3, length: 0.4, wave: 'sawtooth', volume: 0.07 },
    ],
  },
};

const browserContext = (): AudioContextLike | null => {
  const Ctor =
    (globalThis as { AudioContext?: new () => AudioContextLike }).AudioContext ??
    (globalThis as { webkitAudioContext?: new () => AudioContextLike }).webkitAudioContext;
  return Ctor ? new Ctor() : null;
};

/**
 * Optional chiptune sound effects. Off until switched on (browsers only allow
 * sound after a click anyway), and each sound is rate-limited so a busy world
 * doesn't turn into noise.
 */
export class Chiptune {
  private context: AudioContextLike | null = null;
  private enabledFlag = false;
  private readonly lastPlayed = new Map<Sound, number>();

  constructor(
    private readonly makeContext: () => AudioContextLike | null = browserContext,
    private readonly now: () => number = () => performance.now(),
  ) {}

  get enabled(): boolean {
    return this.enabledFlag;
  }

  set enabled(on: boolean) {
    this.enabledFlag = on;
    if (on) {
      this.context ??= this.makeContext();
      void this.context?.resume?.();
    }
  }

  /** Play a sound if sound is on and it hasn't just played. Returns whether it did. */
  play(sound: Sound): boolean {
    if (!this.enabledFlag || !this.context) return false;
    const { notes, minGapMs } = SOUNDS[sound];
    const t = this.now();
    const last = this.lastPlayed.get(sound);
    if (last !== undefined && t - last < minGapMs) return false;
    this.lastPlayed.set(sound, t);

    const ctx = this.context;
    const start = ctx.currentTime;
    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = note.wave;
      osc.frequency.setValueAtTime(note.from, start + note.at);
      osc.frequency.linearRampToValueAtTime(note.to, start + note.at + note.length);
      gain.gain.setValueAtTime(note.volume, start + note.at);
      gain.gain.linearRampToValueAtTime(0, start + note.at + note.length);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start + note.at);
      osc.stop(start + note.at + note.length);
    }
    return true;
  }
}
