import { BRAIN_VIEW_HEIGHT, drawBrain } from '../render/brain-view';
import {
  CHART_HEIGHTS,
  CHART_WIDTH,
  drawDietHistogram,
  drawPopulation,
  drawSpeciesCount,
  drawSpeciesTree,
  drawTraits,
} from '../render/charts';
import { CanvasSurface } from '../render/surface';
import type { Overlay, RenderMode, ViewState } from '../render/view';
import type { Analysis, CreatureDetail, Scene } from '../runtime/types';
import type { SimConfig } from '../sim/config';
import { dietClass } from '../sim/species';
import { DISASTER_INFO, DISASTER_KINDS, type DisasterKind } from '../sim/disasters';
import { CONTROLS, decimalsFor, type Control } from './controls';

export interface PanelActions {
  togglePause(): void;
  step(): void;
  changeSpeed(direction: 1 | -1): void;
  /** Start a new world with the pending settings and this seed. */
  newWorld(seed: number): void;
  /** A live control changed this value: apply it to the running simulation. */
  applyLive(control: Control, value: number | boolean | string): void;
  /** Make a disaster or introduction happen now. */
  trigger(kind: DisasterKind): void;
  toggleGlyph(): void;
  cycleOverlay(direction: 1 | -1): void;
}

/** What the panel shows, refreshed every frame. */
export interface PanelData {
  scene: Scene;
  detail: CreatureDetail | null;
  analysis: Analysis;
  view: ViewState;
}

const TABS = ['RULES', 'STATS', 'INSPECT', 'LOG'] as const;
type Tab = (typeof TABS)[number];

/** How often the inspector redraws (ms). */
const INSPECT_EVERY_MS = 100;

/** The side panel: playback, view options, world rules, statistics, an inspector and an event log. */
export class Panel {
  private readonly pauseButton: HTMLButtonElement;
  private readonly speedLabel: HTMLElement;
  private readonly modeButton: HTMLButtonElement;
  private readonly overlayLabel: HTMLElement;
  private readonly seedInput: HTMLInputElement;
  private readonly inputs = new Map<Control, HTMLInputElement>();
  private readonly values = new Map<Control, HTMLElement>();
  private readonly tabButtons = new Map<Tab, HTMLButtonElement>();
  private readonly tabBodies = new Map<Tab, HTMLElement>();
  private active: Tab = 'RULES';

  private readonly charts: Record<
    'population' | 'traits' | 'species' | 'diet' | 'tree',
    CanvasSurface
  >;
  private readonly brainSurface: CanvasSurface;
  private readonly inspectInfo: HTMLElement;
  private readonly inspectEmpty: HTMLElement;
  private readonly inspectBody: HTMLElement;
  private readonly logList: HTMLElement;
  private lastAnalysisVersion = -1;
  private lastInspect = 0;
  private lastLogKey = '';

  constructor(
    root: HTMLElement,
    private readonly settings: SimConfig,
    private readonly actions: PanelActions,
  ) {
    root.innerHTML = '';
    root.append(el('h1', 'ARTILIFE'));

    const nav = el('nav', '', 'tabs');
    root.append(nav);
    for (const name of TABS) {
      const b = button(name, () => this.showTab(name));
      this.tabButtons.set(name, b);
      nav.append(b);
      const body = el('div', '', 'tab');
      this.tabBodies.set(name, body);
      root.append(body);
    }

    // RULES
    const rules = this.tabBodies.get('RULES')!;
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
    rules.append(playback);

    const view = el('section');
    view.append(el('h2', 'VIEW'));
    const viewRow = el('div', '', 'row');
    this.modeButton = button('TILES', () => actions.toggleGlyph());
    this.overlayLabel = el('span', 'NONE', 'overlay');
    viewRow.append(
      this.modeButton,
      el('span', 'COLOUR'),
      button('<', () => actions.cycleOverlay(-1)),
      this.overlayLabel,
      button('>', () => actions.cycleOverlay(1)),
    );
    view.append(viewRow);
    rules.append(view);

    const groups = new Map<string, HTMLElement>();
    for (const control of CONTROLS) {
      let section = groups.get(control.group);
      if (!section) {
        section = el('section');
        section.append(el('h2', control.group));
        groups.set(control.group, section);
        rules.append(section);
      }
      section.append(this.buildControl(control));
    }

    const disasters = el('section');
    disasters.append(el('h2', 'DISASTERS'));
    const disasterRow = el('div', '', 'wrap');
    for (const kind of DISASTER_KINDS) {
      const b = button(DISASTER_INFO[kind].label, () => actions.trigger(kind));
      b.title = DISASTER_INFO[kind].hint;
      disasterRow.append(b);
    }
    disasters.append(disasterRow);
    groups.get('EVOLUTION')!.after(disasters);

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
    rules.append(
      el(
        'p',
        'CLICK a creature to follow it. DRAG or ARROWS to scroll. SPACE pauses, . steps, [ ] changes speed, G switches tiles/glyphs, O changes colouring.',
        'help',
      ),
    );

    // STATS
    const stats = this.tabBodies.get('STATS')!;
    const chart = (h: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = CHART_WIDTH;
      canvas.height = h;
      canvas.className = 'chart';
      stats.append(canvas);
      return new CanvasSurface(canvas.getContext('2d')!);
    };
    this.charts = {
      population: chart(CHART_HEIGHTS.population),
      traits: chart(CHART_HEIGHTS.traits),
      species: chart(CHART_HEIGHTS.species),
      diet: chart(CHART_HEIGHTS.diet),
      tree: chart(CHART_HEIGHTS.tree),
    };
    stats.append(
      el(
        'p',
        'POPULATION: white. Red: share that are hunters. TRAITS are scaled to their range.',
        'help',
      ),
    );

    // INSPECT
    const inspect = this.tabBodies.get('INSPECT')!;
    this.inspectEmpty = el('p', 'CLICK A CREATURE ON THE MAP TO INSPECT IT.', 'help');
    this.inspectBody = el('div');
    this.inspectInfo = el('dl', '', 'info');
    const brainCanvas = document.createElement('canvas');
    brainCanvas.width = CHART_WIDTH;
    brainCanvas.height = BRAIN_VIEW_HEIGHT;
    brainCanvas.className = 'chart';
    this.brainSurface = new CanvasSurface(brainCanvas.getContext('2d')!);
    this.inspectBody.append(this.inspectInfo, brainCanvas);
    inspect.append(this.inspectEmpty, this.inspectBody);

    // LOG
    this.logList = el('ol', '', 'log');
    this.tabBodies.get('LOG')!.append(this.logList);

    this.showTab('RULES');
  }

  private seed(): number {
    const n = Math.floor(Number(this.seedInput.value));
    return Number.isFinite(n) ? n : 1;
  }

  showTab(tab: Tab): void {
    this.active = tab;
    for (const name of TABS) {
      this.tabBodies.get(name)!.hidden = name !== tab;
      this.tabButtons.get(name)!.classList.toggle('active', name === tab);
    }
    this.lastAnalysisVersion = -1;
    this.lastInspect = 0;
    this.lastLogKey = '';
  }

  private buildControl(control: Control): HTMLElement {
    const row = el('label', '', 'control');
    row.title = control.hint;
    const name = el('span', control.label, 'name');
    const value = el('span', '', 'value');
    const input = document.createElement('input');
    this.inputs.set(control, input);
    this.values.set(control, value);

    if (control.kind === 'choice') {
      const select = document.createElement('select');
      for (const option of control.choices ?? []) {
        const o = document.createElement('option');
        o.value = option;
        o.textContent = option.toUpperCase();
        select.append(o);
      }
      select.value = String(control.get(this.settings));
      select.addEventListener('change', () => this.change(control, select.value));
      row.append(name, value, select);
      this.showValue(control);
      return row;
    }
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

  private change(control: Control, v: number | boolean | string): void {
    control.set(this.settings, v);
    if (!control.needsReset) this.actions.applyLive(control, v);
    this.showValue(control);
  }

  private showValue(control: Control): void {
    const v = control.get(this.settings);
    this.values.get(control)!.textContent =
      typeof v === 'boolean'
        ? v
          ? 'ON'
          : 'OFF'
        : typeof v === 'string'
          ? ''
          : v.toFixed(decimalsFor(control.step ?? 1));
  }

  setPaused(paused: boolean): void {
    this.pauseButton.textContent = paused ? 'PLAY' : 'PAUSE';
  }

  setSpeed(multiplier: number, tps?: number): void {
    this.speedLabel.textContent = tps === undefined ? `X${multiplier}` : `X${multiplier} ${tps}/S`;
  }

  setSeed(seed: number): void {
    this.seedInput.value = String(seed);
  }

  setView(mode: RenderMode, overlay: Overlay): void {
    this.modeButton.textContent = mode === 'tile' ? 'TILES' : 'GLYPHS';
    this.overlayLabel.textContent = overlay.toUpperCase();
  }

  /** Redraw whatever the open tab shows. Cheap when nothing changed. */
  update(data: PanelData, now: number): void {
    if (this.active === 'STATS') this.updateStats(data);
    else if (this.active === 'INSPECT') this.updateInspect(data, now);
    else if (this.active === 'LOG') this.updateLog(data);
  }

  private updateStats({ analysis, scene }: PanelData): void {
    if (analysis.version === this.lastAnalysisVersion) return;
    this.lastAnalysisVersion = analysis.version;
    drawPopulation(this.charts.population, analysis.history);
    drawTraits(this.charts.traits, analysis.history);
    drawSpeciesCount(this.charts.species, analysis.history);
    drawDietHistogram(this.charts.diet, analysis.dietHistogram);
    drawSpeciesTree(this.charts.tree, analysis.species, scene.tick);
  }

  private updateInspect({ detail }: PanelData, now: number): void {
    this.inspectEmpty.hidden = detail !== null;
    this.inspectBody.hidden = detail === null;
    if (!detail || now - this.lastInspect < INSPECT_EVERY_MS) return;
    this.lastInspect = now;
    const t = detail.traits;
    const rows: [string, string][] = [
      ['CREATURE', `#${detail.id}`],
      ['PARENT', detail.parentId === null ? 'NONE' : `#${detail.parentId}`],
      ['GENERATION', String(detail.generation)],
      ['AGE', String(detail.age)],
      ['ENERGY', detail.energy.toFixed(1)],
      ['SPECIES', `${detail.speciesId} ${dietClass(t.diet)}`],
      ['SIZE', t.size.toFixed(2)],
      ['MAX SPEED', t.maxSpeed.toFixed(2)],
      ['VISION', `${t.visionRange.toFixed(1)} TILES`],
      ['FIELD OF VIEW', `${Math.round((t.visionFov * 180) / Math.PI)} DEG`],
      ['DIET', t.diet.toFixed(2)],
      ['MUTATION', t.mutationRate.toFixed(3)],
      ['BREEDS AT', `${Math.round(t.reproThreshold * 100)}% ENERGY`],
    ];
    this.inspectInfo.replaceChildren(...rows.flatMap(([k, v]) => [el('dt', k), el('dd', v)]));
    drawBrain(this.brainSurface, detail.brain);
  }

  private updateLog({ analysis }: PanelData): void {
    const { events } = analysis;
    const last = events[events.length - 1];
    const key = `${events.length}:${last ? `${last.tick}:${last.text}` : ''}`;
    if (key === this.lastLogKey) return;
    this.lastLogKey = key;
    if (events.length === 0) {
      this.logList.replaceChildren(el('li', 'NOTHING HAS HAPPENED YET.', 'empty'));
      return;
    }
    this.logList.replaceChildren(
      ...[...events].reverse().map((e) => {
        const li = el('li', '', e.major ? 'major' : '');
        li.append(el('span', `T${e.tick}`, 'when'), document.createTextNode(` ${e.text}`));
        return li;
      }),
    );
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
