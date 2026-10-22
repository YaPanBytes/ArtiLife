import type { SimConfig } from '../sim/config';
import { CONTROLS, decimalsFor, type Control } from './controls';

export interface PanelActions {
  togglePause(): void;
  step(): void;
  changeSpeed(direction: 1 | -1): void;
  /** Start a new world with the pending settings and this seed. */
  newWorld(seed: number): void;
  /** A live control changed this value: apply it to the running simulation. */
  applyLive(control: Control, value: number | boolean): void;
}

/** The side panel: playback buttons and one slider per world rule. */
export class Panel {
  private readonly pauseButton: HTMLButtonElement;
  private readonly speedLabel: HTMLElement;
  private readonly seedInput: HTMLInputElement;
  private readonly inputs = new Map<Control, HTMLInputElement>();
  private readonly values = new Map<Control, HTMLElement>();

  constructor(
    root: HTMLElement,
    private readonly settings: SimConfig,
    private readonly actions: PanelActions,
  ) {
    root.innerHTML = '';
    root.append(el('h1', 'ARTILIFE'));

    const playback = el('div', '', 'row');
    this.pauseButton = button('PAUSE', () => actions.togglePause());
    this.speedLabel = el('span', 'X4', 'speed');
    playback.append(
      this.pauseButton,
      button('STEP', () => actions.step()),
      button('-', () => actions.changeSpeed(-1)),
      this.speedLabel,
      button('+', () => actions.changeSpeed(1)),
    );
    root.append(playback);

    const groups = new Map<string, HTMLElement>();
    for (const control of CONTROLS) {
      let section = groups.get(control.group);
      if (!section) {
        section = el('section');
        section.append(el('h2', control.group));
        groups.set(control.group, section);
        root.append(section);
      }
      section.append(this.buildControl(control));
    }

    const world = groups.get('NEW WORLD')!;
    const seedRow = el('div', '', 'row');
    this.seedInput = document.createElement('input');
    this.seedInput.type = 'number';
    this.seedInput.value = String(settings.seed);
    this.seedInput.title = 'Seed: the same seed and rules make the same world.';
    seedRow.append(
      el('span', 'SEED'),
      this.seedInput,
      button('GO', () => actions.newWorld(this.seed())),
      button('RND', () => {
        this.seedInput.value = String(Math.floor(Math.random() * 1e6));
        actions.newWorld(this.seed());
      }),
    );
    world.append(seedRow);

    root.append(
      el(
        'p',
        'CLICK a creature to follow it. DRAG or ARROWS to scroll. SPACE pauses, . steps, [ ] changes speed.',
        'help',
      ),
    );
  }

  private seed(): number {
    const n = Math.floor(Number(this.seedInput.value));
    return Number.isFinite(n) ? n : 1;
  }

  private buildControl(control: Control): HTMLElement {
    const row = el('label', '', 'control');
    row.title = control.hint;
    const name = el('span', control.label, 'name');
    const value = el('span', '', 'value');
    const input = document.createElement('input');
    this.inputs.set(control, input);
    this.values.set(control, value);

    if (control.kind === 'toggle') {
      input.type = 'checkbox';
      input.checked = control.get(this.settings) as boolean;
      input.addEventListener('change', () => this.change(control, input.checked));
    } else {
      input.type = 'range';
      input.min = String(control.min);
      input.max = String(control.max);
      input.step = String(control.step);
      input.value = String(control.get(this.settings));
      input.addEventListener('input', () => this.change(control, Number(input.value)));
    }
    row.append(name, value, input);
    this.showValue(control);
    return row;
  }

  private change(control: Control, v: number | boolean): void {
    control.set(this.settings, v);
    if (!control.needsReset) this.actions.applyLive(control, v);
    this.showValue(control);
  }

  private showValue(control: Control): void {
    const v = control.get(this.settings);
    this.values.get(control)!.textContent =
      typeof v === 'boolean' ? (v ? 'ON' : 'OFF') : v.toFixed(decimalsFor(control.step ?? 1));
  }

  setPaused(paused: boolean): void {
    this.pauseButton.textContent = paused ? 'PLAY' : 'PAUSE';
  }

  setSpeed(multiplier: number): void {
    this.speedLabel.textContent = `X${multiplier}`;
  }

  setSeed(seed: number): void {
    this.seedInput.value = String(seed);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = '',
  className = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}
