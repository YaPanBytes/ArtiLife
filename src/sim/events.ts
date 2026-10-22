export type EventKind =
  | 'speciation'
  | 'extinction'
  | 'population'
  | 'predator'
  | 'generation'
  | 'season'
  | 'disaster'
  | 'info';

export interface SimEvent {
  tick: number;
  kind: EventKind;
  text: string;
  /** Worth showing on screen as it happens, not just in the log. */
  major: boolean;
}

/** A capped list of things that happened, newest last. */
export class EventLog {
  readonly events: SimEvent[] = [];
  /** Bumped on every new event, so views know to refresh. */
  version = 0;
  onEvent?: (event: SimEvent) => void;

  constructor(private readonly capacity = 300) {}

  push(tick: number, kind: EventKind, text: string, major = false): void {
    const event = { tick, kind, text, major };
    this.events.push(event);
    if (this.events.length > this.capacity) this.events.shift();
    this.version++;
    this.onEvent?.(event);
  }

  clear(): void {
    this.events.length = 0;
    this.version++;
  }
}
