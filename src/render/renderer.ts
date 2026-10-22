import {
  EFFECT_BIRTH,
  EFFECT_HIT,
  type Analysis,
  type CreatureDetail,
  type Scene,
  type WorldInfo,
} from '../runtime/types';
import { TRAIT_ORDER } from '../sim/genome';
import { dietClass } from '../sim/species';
import { Terrain } from '../sim/world';
import { HEART_COUNT, formatCount, heartsFor } from './hud';
import { FIELD_H, FIELD_W, HUD_H, MINIMAP_SIZE, SCREEN_H, SCREEN_W, TILE } from './layout';
import {
  COLORS,
  FOOD_HEAT,
  HUE_COLUMN_COUNT,
  RAMPS,
  css,
  creatureColors,
  hueColumn,
  nes,
  rampColumn,
  speciesColumn,
  type RGB,
} from './palette';
import { Atlas, type Sprite } from './sprites';
import type { Overlay, ViewState } from './view';

const FONT = '8px "Press Start 2P"';
/** Creatures at least this big are drawn at double size (16x16). */
const LARGE_SIZE = 1.3;
const EFFECT_FRAMES = 24;
/** Bite flashes are quick. */
const HIT_FRAMES = 8;
const MAX_EFFECTS = 200;
/** Calls quieter than this aren't drawn. */
const CALL_VISIBLE = 0.3;
/** Creatures with at least this diet are drawn as predators. */
const PREDATOR_DIET = 0.5;
/** How long a headline stays on screen, in frames. */
const TICKER_FRAMES = 360;
const TICKER_LINES = 2;
/** Age that fills the age ramp when creatures never die of old age. */
const DEFAULT_AGE_SCALE = 3000;

/** Plant stage thresholds, as a fraction of a full tile. */
const STAGE_SPROUT = 0.12;
const STAGE_TUFT = 0.4;
const STAGE_BUSH = 0.75;

const GENE = {
  size: TRAIT_ORDER.indexOf('size'),
  speed: TRAIT_ORDER.indexOf('maxSpeed'),
  vision: TRAIT_ORDER.indexOf('visionRange'),
  fov: TRAIT_ORDER.indexOf('visionFov'),
  diet: TRAIT_ORDER.indexOf('diet'),
};

const OVERLAY_NAMES: Record<Overlay, string> = {
  none: '',
  energy: 'ENERGY',
  age: 'AGE',
  diet: 'DIET',
  species: 'SPECIES',
  food: 'FOOD',
};

interface Effect {
  kind: number;
  /** World position in tiles. */
  x: number;
  y: number;
  startFrame: number;
}

interface Headline {
  text: string;
  startFrame: number;
}

/**
 * Draws the game into a 256x224 canvas: the scrolling playfield on the bottom,
 * the HUD on top. All drawing lands on whole pixels, with no smoothing.
 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly atlas = new Atlas();
  private readonly effects: Effect[] = [];
  private readonly headlines: Headline[] = [];
  private lastEventKey = '';
  private frame = 0;
  private minimap: Sprite | null = null;
  private readonly dotColors = Array.from({ length: HUE_COLUMN_COUNT }, (_, i) =>
    css(creatureColors((i + 0.5) / HUE_COLUMN_COUNT).body),
  );

  constructor(readonly canvas: HTMLCanvasElement) {
    canvas.width = SCREEN_W;
    canvas.height = SCREEN_H;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Call when a new world starts: rebuilds the minimap and clears effects. */
  setWorld(world: WorldInfo): void {
    this.minimap = this.buildMinimap(world);
    this.effects.length = 0;
    this.headlines.length = 0;
    this.lastEventKey = '';
  }

  render(
    scene: Scene,
    world: WorldInfo,
    detail: CreatureDetail | null,
    analysis: Analysis,
    view: ViewState,
  ): void {
    this.frame++;
    this.takeEffects(scene);
    this.takeHeadlines(analysis);
    const selected = view.selectedId === null ? -1 : scene.indexOfId(view.selectedId);
    const { camera } = view;
    if (view.mode === 'glyph') this.drawGlyphs(scene, world, camera.x, camera.y, view, selected);
    else {
      this.drawTerrain(scene, world, camera.x, camera.y, view.overlay === 'food');
      this.drawCreatures(scene, view, selected);
      this.drawEffects(view);
    }
    this.drawTicker();
    let labelRow = 0;
    if (view.overlay !== 'none') {
      this.drawLabel(`SHOWING ${OVERLAY_NAMES[view.overlay]}`, labelRow++, COLORS.white);
    }
    for (const hazard of scene.hazards) this.drawLabel(hazard, labelRow++, COLORS.red);
    if (view.paused && (this.frame >> 5) % 2 === 0) this.drawPaused();
    this.drawHud(scene, world, detail, view, selected);
  }

  private takeEffects(scene: Scene): void {
    const e = scene.effects;
    for (let i = 0; i + 2 < e.length; i += 3) {
      if (this.effects.length >= MAX_EFFECTS) this.effects.shift();
      this.effects.push({ kind: e[i], x: e[i + 1], y: e[i + 2], startFrame: this.frame });
    }
    scene.effects = [];
  }

  /** Remember new major events so they can be shown for a few seconds. */
  private takeHeadlines(analysis: Analysis): void {
    const { events } = analysis;
    const fresh = [];
    for (let i = events.length - 1; i >= 0; i--) {
      const key = `${events[i].tick}:${events[i].text}`;
      if (key === this.lastEventKey) break;
      if (events[i].major) fresh.push(events[i]);
    }
    if (events.length > 0) {
      const last = events[events.length - 1];
      this.lastEventKey = `${last.tick}:${last.text}`;
    }
    for (const e of fresh.reverse()) {
      this.headlines.push({ text: e.text, startFrame: this.frame });
    }
    while (this.headlines.length > 0 && this.frame - this.headlines[0].startFrame > TICKER_FRAMES) {
      this.headlines.shift();
    }
  }

  // Playfield: tiles

  private drawTerrain(
    scene: Scene,
    world: WorldInfo,
    camX: number,
    camY: number,
    heat: boolean,
  ): void {
    const { ctx, atlas } = this;
    const px = Math.round(camX);
    const py = Math.round(camY);
    const tx0 = Math.floor(px / TILE);
    const ty0 = Math.floor(py / TILE);
    const ox = px - tx0 * TILE;
    const oy = py - ty0 * TILE;
    const cols = FIELD_W / TILE + 1;
    const rows = FIELD_H / TILE + 1;
    const water = this.frame >> 5;
    for (let r = 0; r < rows; r++) {
      const ty = (((ty0 + r) % world.height) + world.height) % world.height;
      for (let c = 0; c < cols; c++) {
        const tx = (((tx0 + c) % world.width) + world.width) % world.width;
        const i = ty * world.width + tx;
        const x = c * TILE - ox;
        const y = HUD_H + r * TILE - oy;
        const terrain = world.terrain[i];
        if (terrain === Terrain.Water) {
          ctx.drawImage(atlas.water[(water + tx + ty) & 1], x, y);
        } else if (terrain === Terrain.Rock) {
          ctx.drawImage(atlas.rock, x, y);
        } else {
          const food = scene.food[i] / scene.maxFood;
          if (heat) {
            const level = Math.min(FOOD_HEAT.length - 1, Math.floor(food * FOOD_HEAT.length));
            ctx.drawImage(atlas.heat[level], x, y);
            continue;
          }
          ctx.drawImage(atlas.ground[((tx * 7 + ty * 13 + ((tx * ty) >> 2)) >>> 0) & 3], x, y);
          if (food >= STAGE_SPROUT) {
            const stage = food >= STAGE_BUSH ? 2 : food >= STAGE_TUFT ? 1 : 0;
            ctx.drawImage(atlas.plants[stage], x, y);
          }
        }
      }
    }
  }

  private columnFor(scene: Scene, i: number, overlay: Overlay): number {
    switch (overlay) {
      case 'energy':
        return rampColumn(RAMPS.energy, scene.energy[i] / scene.maxEnergy);
      case 'age': {
        const scale = scene.maxAge > 0 ? scene.maxAge : DEFAULT_AGE_SCALE;
        return rampColumn(RAMPS.age, scene.age[i] / scale);
      }
      case 'diet':
        return rampColumn(RAMPS.diet, scene.diet[i]);
      case 'species':
        return speciesColumn(scene.species[i]);
      default:
        return hueColumn(scene.hue[i]);
    }
  }

  private drawCreatures(scene: Scene, view: ViewState, selected: number): void {
    const { ctx, atlas } = this;
    const { camera } = view;
    for (let i = 0; i < scene.count; i++) {
      const [sx, sy] = camera.toScreen(scene.x[i] * TILE, scene.y[i] * TILE);
      const large = scene.size[i] >= LARGE_SIZE;
      const size = large ? 2 * TILE : TILE;
      if (sx < -size || sx > FIELD_W + size || sy < -size || sy > FIELD_H + size) continue;
      const walkFrame =
        scene.speed[i] > 0.03 ? ((((this.frame >> 3) + scene.id[i]) & 1) as 0 | 1) : 0;
      const sprite = atlas.creature(
        this.columnFor(scene, i, view.overlay),
        walkFrame,
        Math.cos(scene.heading[i]) < 0,
        large,
        scene.diet[i] >= PREDATOR_DIET,
      );
      const x = Math.round(sx - size / 2);
      const y = HUD_H + Math.round(sy - size / 2);
      ctx.drawImage(sprite, x, y);
      this.drawCall(scene.signal[i], x, y, size);
      if (i === selected && (this.frame >> 3) % 2 === 0) this.drawBrackets(x - 2, y - 2, size + 4);
    }
  }

  /** A loud call shows as a pair of dots above the creature: white for positive, blue for negative. */
  private drawCall(signal: number, x: number, y: number, size: number): void {
    if (Math.abs(signal) < CALL_VISIBLE) return;
    const color = signal > 0 ? COLORS.white : nes(0x21);
    this.fillRect(color, x + (size >> 1) - 1, y - 3, 1, 1);
    this.fillRect(color, x + (size >> 1) + 1, y - 3, 1, 1);
    if (Math.abs(signal) > 0.7) this.fillRect(color, x + (size >> 1), y - 5, 1, 1);
  }

  private drawBrackets(x: number, y: number, size: number): void {
    const { ctx } = this;
    ctx.fillStyle = css(COLORS.white);
    const arm = 3;
    const edge = size - 1;
    for (const [cx, cy, dx, dy] of [
      [x, y, 1, 1],
      [x + edge, y, -1, 1],
      [x, y + edge, 1, -1],
      [x + edge, y + edge, -1, -1],
    ] as const) {
      ctx.fillRect(dx > 0 ? cx : cx - arm + 1, cy, arm, 1);
      ctx.fillRect(cx, dy > 0 ? cy : cy - arm + 1, 1, arm);
    }
  }

  private drawEffects(view: ViewState): void {
    const { ctx, atlas, effects } = this;
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      const age = this.frame - e.startFrame;
      const life = e.kind === EFFECT_HIT ? HIT_FRAMES : EFFECT_FRAMES;
      if (age >= life) {
        effects.splice(i, 1);
        continue;
      }
      const frames =
        e.kind === EFFECT_BIRTH ? atlas.sparkle : e.kind === EFFECT_HIT ? atlas.hit : atlas.puff;
      const sprite = frames[Math.min(frames.length - 1, Math.floor((age / life) * frames.length))];
      const [sx, sy] = view.camera.toScreen(e.x * TILE, e.y * TILE);
      if (sx < -TILE || sx > FIELD_W + TILE || sy < -TILE || sy > FIELD_H + TILE) continue;
      ctx.drawImage(sprite, Math.round(sx - TILE / 2), HUD_H + Math.round(sy - TILE / 2));
    }
  }

  // Playfield: glyph mode (Dwarf Fortress style)

  private drawGlyphs(
    scene: Scene,
    world: WorldInfo,
    camX: number,
    camY: number,
    view: ViewState,
    selected: number,
  ): void {
    const { ctx } = this;
    this.fillRect(COLORS.black, 0, HUD_H, FIELD_W, FIELD_H);
    ctx.font = FONT;
    ctx.textBaseline = 'top';
    const px = Math.round(camX);
    const py = Math.round(camY);
    const tx0 = Math.floor(px / TILE);
    const ty0 = Math.floor(py / TILE);
    const ox = px - tx0 * TILE;
    const oy = py - ty0 * TILE;
    const cols = FIELD_W / TILE + 1;
    const rows = FIELD_H / TILE + 1;
    const heat = view.overlay === 'food';
    for (let r = 0; r < rows; r++) {
      const ty = (((ty0 + r) % world.height) + world.height) % world.height;
      for (let c = 0; c < cols; c++) {
        const tx = (((tx0 + c) % world.width) + world.width) % world.width;
        const i = ty * world.width + tx;
        const x = c * TILE - ox;
        const y = HUD_H + r * TILE - oy;
        const terrain = world.terrain[i];
        if (terrain === Terrain.Water) {
          ctx.fillStyle = css(COLORS.waterSpeck);
          ctx.fillText(((this.frame >> 5) + tx + ty) & 1 ? '~' : '-', x, y);
        } else if (terrain === Terrain.Rock) {
          ctx.fillStyle = css(COLORS.rock);
          ctx.fillText('#', x, y);
        } else {
          const food = scene.food[i] / scene.maxFood;
          if (heat) {
            ctx.fillStyle = css(
              FOOD_HEAT[Math.min(FOOD_HEAT.length - 1, Math.floor(food * FOOD_HEAT.length))],
            );
            ctx.fillText('.', x, y);
          } else if (food >= STAGE_SPROUT) {
            ctx.fillStyle = css(
              food >= STAGE_BUSH
                ? COLORS.greenLight
                : food >= STAGE_TUFT
                  ? COLORS.green
                  : COLORS.greenDark,
            );
            ctx.fillText(food >= STAGE_BUSH ? '"' : food >= STAGE_TUFT ? ',' : '.', x, y);
          }
        }
      }
    }
    // Creatures: a letter for what it eats, upper case when big, coloured like its sprite would be.
    for (let i = 0; i < scene.count; i++) {
      const [sx, sy] = view.camera.toScreen(scene.x[i] * TILE, scene.y[i] * TILE);
      if (sx < -TILE || sx > FIELD_W + TILE || sy < -TILE || sy > FIELD_H + TILE) continue;
      const cx = Math.round(sx - TILE / 2);
      const cy = HUD_H + Math.round(sy - TILE / 2);
      const letter = glyphFor(scene.diet[i], scene.size[i] >= LARGE_SIZE);
      const column = this.columnFor(scene, i, view.overlay);
      if (i === selected) {
        this.fillRect(COLORS.white, cx, cy, TILE, TILE);
        ctx.fillStyle = css(COLORS.black);
      } else {
        ctx.fillStyle = css(nes(0x20 + column));
      }
      ctx.fillText(letter, cx, cy);
    }
  }

  // Playfield: overlays on top

  private drawTicker(): void {
    const lines = this.headlines.slice(-TICKER_LINES);
    lines.forEach((line, i) => {
      const y = SCREEN_H - (lines.length - i) * 9;
      this.fillRect(COLORS.black, 0, y, SCREEN_W, 9);
      this.text(line.text.slice(0, 32), 0, y + 1, COLORS.white);
    });
  }

  private drawLabel(label: string, row: number, color: RGB): void {
    const y = HUD_H + row * 10;
    this.fillRect(COLORS.black, 0, y, label.length * 8 + 4, 10);
    this.text(label, 2, y + 1, color);
  }

  private drawPaused(): void {
    this.fillRect(COLORS.black, 100, HUD_H + 6, 56, 12);
    this.text('PAUSED', 104, HUD_H + 8, COLORS.white);
  }

  // HUD

  private drawHud(
    scene: Scene,
    world: WorldInfo,
    detail: CreatureDetail | null,
    view: ViewState,
    selected: number,
  ): void {
    const { ctx, atlas } = this;
    this.fillRect(COLORS.black, 0, 0, SCREEN_W, HUD_H);

    this.fillRect(COLORS.grayLight, 7, 3, MINIMAP_SIZE + 2, MINIMAP_SIZE + 2);
    if (this.minimap) ctx.drawImage(this.minimap, 8, 4);
    this.drawMinimapOverlay(scene, world, view, selected);

    let generation = 0;
    let energy = 0;
    for (let i = 0; i < scene.count; i++) {
      generation += scene.generation[i];
      energy += scene.energy[i];
    }
    if (scene.count > 0) {
      generation /= scene.count;
      energy /= scene.count;
    }
    const { stats, season } = scene;
    const rows = [
      `POP  ${formatCount(scene.count, 4)}`,
      `BORN ${formatCount(stats.births, 4)}`,
      `DEAD ${formatCount(stats.starved + stats.diedOfAge + stats.eaten + stats.disaster, 4)}`,
      `GEN  ${formatCount(generation, 4)}`,
      season ? `Y${formatCount(season.year, 2)} ${season.name}` : `T${scene.tick}`,
    ];
    rows.forEach((row, i) => this.text(row, 62, 6 + i * 9, COLORS.white));

    this.text('B', 154, 4, COLORS.white);
    this.text('A', 182, 4, COLORS.white);
    this.drawSlot(146, 14);
    this.drawSlot(174, 14);
    if (detail) {
      const column = hueColumn(detail.traits.hue);
      ctx.drawImage(
        atlas.creature(column, 0, false, true, detail.traits.diet >= PREDATOR_DIET),
        150,
        22,
      );
      const genes = [GENE.size, GENE.speed, GENE.vision, GENE.fov, GENE.diet];
      genes.forEach((gene, i) => {
        const y = 17 + i * 5;
        this.fillRect(COLORS.grayDark, 178, y, 16, 3);
        this.fillRect(
          COLORS.white,
          178,
          y,
          Math.max(1, Math.round(detail.traitGenes[gene] * 16)),
          3,
        );
      });
    }

    this.text('-LIFE-', 206, 6, COLORS.red);
    const energyFraction = detail ? detail.energy / scene.maxEnergy : energy / scene.maxEnergy;
    const hearts = heartsFor(energyFraction);
    for (let i = 0; i < HEART_COUNT; i++) {
      ctx.drawImage(atlas.hearts[hearts[i]], 206 + (i % 5) * TILE, 22 + Math.floor(i / 5) * 9);
    }
  }

  private drawSlot(x: number, y: number): void {
    this.fillRect(COLORS.blue, x, y, 24, 32);
    this.fillRect(COLORS.black, x + 2, y + 2, 20, 28);
  }

  private drawMinimapOverlay(
    scene: Scene,
    world: WorldInfo,
    view: ViewState,
    selected: number,
  ): void {
    const { ctx } = this;
    const scaleX = MINIMAP_SIZE / world.width;
    const scaleY = MINIMAP_SIZE / world.height;
    ctx.save();
    ctx.beginPath();
    ctx.rect(8, 4, MINIMAP_SIZE, MINIMAP_SIZE);
    ctx.clip();
    for (let i = 0; i < scene.count; i++) {
      const column = Math.min(HUE_COLUMN_COUNT - 1, Math.floor(scene.hue[i] * HUE_COLUMN_COUNT));
      ctx.fillStyle = this.dotColors[column];
      ctx.fillRect(8 + Math.floor(scene.x[i] * scaleX), 4 + Math.floor(scene.y[i] * scaleY), 1, 1);
    }
    // The part of the world on screen, drawn in each wrapped copy so it never gets cut at the seam.
    const { camera } = view;
    const w = Math.round((FIELD_W / TILE) * scaleX);
    const h = Math.round((FIELD_H / TILE) * scaleY);
    const vx = Math.round((camera.x / TILE) * scaleX);
    const vy = Math.round((camera.y / TILE) * scaleY);
    ctx.strokeStyle = css(COLORS.white);
    ctx.lineWidth = 1;
    for (const ox of [-MINIMAP_SIZE, 0, MINIMAP_SIZE]) {
      for (const oy of [-MINIMAP_SIZE, 0, MINIMAP_SIZE]) {
        ctx.strokeRect(8 + vx + ox + 0.5, 4 + vy + oy + 0.5, w - 1, h - 1);
      }
    }
    if (selected >= 0 && (this.frame >> 3) % 2 === 0) {
      ctx.fillStyle = css(COLORS.white);
      ctx.fillRect(
        8 + Math.floor(scene.x[selected] * scaleX) - 1,
        4 + Math.floor(scene.y[selected] * scaleY) - 1,
        3,
        3,
      );
    }
    ctx.restore();
  }

  private buildMinimap(world: WorldInfo): Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = MINIMAP_SIZE;
    canvas.height = MINIMAP_SIZE;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(MINIMAP_SIZE, MINIMAP_SIZE);
    for (let y = 0; y < MINIMAP_SIZE; y++) {
      for (let x = 0; x < MINIMAP_SIZE; x++) {
        const tx = Math.floor((x * world.width) / MINIMAP_SIZE);
        const ty = Math.floor((y * world.height) / MINIMAP_SIZE);
        const t = world.terrain[ty * world.width + tx];
        const color: RGB =
          t === Terrain.Water ? COLORS.water : t === Terrain.Rock ? COLORS.rock : COLORS.ground;
        const o = (y * MINIMAP_SIZE + x) * 4;
        image.data[o] = color[0];
        image.data[o + 1] = color[1];
        image.data[o + 2] = color[2];
        image.data[o + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  // Primitives

  private fillRect(color: RGB, x: number, y: number, w: number, h: number): void {
    this.ctx.fillStyle = css(color);
    this.ctx.fillRect(x, y, w, h);
  }

  private text(str: string, x: number, y: number, color: RGB): void {
    const { ctx } = this;
    ctx.font = FONT;
    ctx.textBaseline = 'top';
    ctx.fillStyle = css(color);
    ctx.fillText(str, x, y);
  }
}

/** The letter for a creature in glyph mode: what it eats, in capitals when it's big. */
export function glyphFor(diet: number, large: boolean): string {
  const letter = { HERBIVORE: 'h', OMNIVORE: 'o', HUNTER: 'w' }[dietClass(diet)];
  return large ? letter.toUpperCase() : letter;
}
