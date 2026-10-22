import type { Creature } from '../sim/creature';
import { TRAIT_ORDER } from '../sim/genome';
import type { Simulation } from '../sim/simulation';
import { Terrain, type World } from '../sim/world';
import { HEART_COUNT, formatCount, heartsFor, seasonInfo } from './hud';
import { FIELD_H, FIELD_W, HUD_H, MINIMAP_SIZE, SCREEN_H, SCREEN_W, TILE } from './layout';
import { COLORS, HUE_COLUMN_COUNT, css, creatureColors, type RGB } from './palette';
import { Atlas, type Sprite } from './sprites';
import type { ViewState } from './view';

const FONT = '8px "Press Start 2P"';
/** Creatures at least this big are drawn at double size (16x16). */
const LARGE_SIZE = 1.3;
const EFFECT_FRAMES = 24;
const MAX_EFFECTS = 200;

/** Plant stage thresholds, as a fraction of a full tile. */
const STAGE_SPROUT = 0.12;
const STAGE_TUFT = 0.4;
const STAGE_BUSH = 0.75;

const GENE_INDEX = {
  size: TRAIT_ORDER.indexOf('size'),
  speed: TRAIT_ORDER.indexOf('maxSpeed'),
  vision: TRAIT_ORDER.indexOf('visionRange'),
  fov: TRAIT_ORDER.indexOf('visionFov'),
};

interface Effect {
  kind: 'birth' | 'death';
  /** World position in tiles. */
  x: number;
  y: number;
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
  setWorld(world: World): void {
    this.minimap = this.buildMinimap(world);
    this.effects.length = 0;
  }

  addBirth(c: Creature): void {
    this.addEffect('birth', c.x, c.y);
  }

  addDeath(c: Creature): void {
    this.addEffect('death', c.x, c.y);
  }

  private addEffect(kind: Effect['kind'], x: number, y: number): void {
    if (this.effects.length >= MAX_EFFECTS) this.effects.shift();
    this.effects.push({ kind, x, y, startFrame: this.frame });
  }

  render(sim: Simulation, view: ViewState): void {
    this.frame++;
    const camera = view.camera;
    const selected =
      view.selectedId === null
        ? null
        : (sim.creatures.find((c) => c.id === view.selectedId) ?? null);
    this.drawTerrain(sim, camera.x, camera.y);
    this.drawCreatures(sim, view, selected);
    this.drawEffects(view);
    if (view.paused && (this.frame >> 5) % 2 === 0) this.drawPaused();
    this.drawHud(sim, view, selected);
  }

  // Playfield

  private drawTerrain(sim: Simulation, camX: number, camY: number): void {
    const { ctx, atlas } = this;
    const { world, config } = sim;
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
          ctx.drawImage(atlas.ground[((tx * 7 + ty * 13 + ((tx * ty) >> 2)) >>> 0) & 3], x, y);
          const food = world.food[i] / config.food.maxPerTile;
          if (food >= STAGE_SPROUT) {
            const stage = food >= STAGE_BUSH ? 2 : food >= STAGE_TUFT ? 1 : 0;
            ctx.drawImage(atlas.plants[stage], x, y);
          }
        }
      }
    }
  }

  private drawCreatures(sim: Simulation, view: ViewState, selected: Creature | null): void {
    const { ctx, atlas } = this;
    const camera = view.camera;
    for (const c of sim.creatures) {
      const [sx, sy] = camera.toScreen(c.x * TILE, c.y * TILE);
      const large = c.traits.size >= LARGE_SIZE;
      const size = large ? 2 * TILE : TILE;
      if (sx < -size || sx > FIELD_W + size || sy < -size || sy > FIELD_H + size) continue;
      const walkFrame = c.speed > 0.03 ? ((((this.frame >> 3) + c.id) & 1) as 0 | 1) : 0;
      const sprite = atlas.creature(c.traits.hue, walkFrame, Math.cos(c.heading) < 0, large);
      const x = Math.round(sx - size / 2);
      const y = HUD_H + Math.round(sy - size / 2);
      ctx.drawImage(sprite, x, y);
      if (c === selected && (this.frame >> 3) % 2 === 0) this.drawBrackets(x - 2, y - 2, size + 4);
    }
  }

  private drawBrackets(x: number, y: number, size: number): void {
    const { ctx } = this;
    ctx.fillStyle = css(COLORS.white);
    const a = 3; // arm length
    const edge = size - 1;
    for (const [cx, cy, dx, dy] of [
      [x, y, 1, 1],
      [x + edge, y, -1, 1],
      [x, y + edge, 1, -1],
      [x + edge, y + edge, -1, -1],
    ] as const) {
      ctx.fillRect(dx > 0 ? cx : cx - a + 1, cy, a, 1);
      ctx.fillRect(cx, dy > 0 ? cy : cy - a + 1, 1, a);
    }
  }

  private drawEffects(view: ViewState): void {
    const { ctx, atlas, effects } = this;
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      const age = this.frame - e.startFrame;
      if (age >= EFFECT_FRAMES) {
        effects.splice(i, 1);
        continue;
      }
      const frames = e.kind === 'birth' ? atlas.sparkle : atlas.puff;
      const sprite =
        frames[Math.min(frames.length - 1, Math.floor((age / EFFECT_FRAMES) * frames.length))];
      const [sx, sy] = view.camera.toScreen(e.x * TILE, e.y * TILE);
      if (sx < -TILE || sx > FIELD_W + TILE || sy < -TILE || sy > FIELD_H + TILE) continue;
      ctx.drawImage(sprite, Math.round(sx - TILE / 2), HUD_H + Math.round(sy - TILE / 2));
    }
  }

  private drawPaused(): void {
    this.fillRect(COLORS.black, 100, HUD_H + 6, 56, 12);
    this.text('PAUSED', 104, HUD_H + 8, COLORS.white);
  }

  // HUD

  private drawHud(sim: Simulation, view: ViewState, selected: Creature | null): void {
    const { ctx, atlas } = this;
    const { creatures, stats, config } = sim;
    this.fillRect(COLORS.black, 0, 0, SCREEN_W, HUD_H);

    // Minimap with a frame.
    this.fillRect(COLORS.grayLight, 7, 3, MINIMAP_SIZE + 2, MINIMAP_SIZE + 2);
    if (this.minimap) ctx.drawImage(this.minimap, 8, 4);
    this.drawMinimapOverlay(sim, view, selected);

    // Counters.
    const generation =
      creatures.length === 0
        ? 0
        : creatures.reduce((sum, c) => sum + c.generation, 0) / creatures.length;
    const season = seasonInfo(sim.tick, config);
    const rows = [
      `POP  ${formatCount(creatures.length, 4)}`,
      `BORN ${formatCount(stats.births, 4)}`,
      `DEAD ${formatCount(stats.starved + stats.diedOfAge, 4)}`,
      `GEN  ${formatCount(generation, 4)}`,
      season ? `Y${formatCount(season.year, 2)} ${season.name}` : `T${sim.tick}`,
    ];
    rows.forEach((row, i) => this.text(row, 62, 6 + i * 9, COLORS.white));

    // B and A slots: the followed creature's portrait and gene bars.
    this.text('B', 154, 4, COLORS.white);
    this.text('A', 182, 4, COLORS.white);
    this.drawSlot(146, 14);
    this.drawSlot(174, 14);
    if (selected) {
      ctx.drawImage(atlas.creature(selected.traits.hue, 0, false, true), 150, 22);
      const genes = [GENE_INDEX.size, GENE_INDEX.speed, GENE_INDEX.vision, GENE_INDEX.fov];
      genes.forEach((gene, i) => {
        const y = 20 + i * 6;
        this.fillRect(COLORS.grayDark, 178, y, 16, 3);
        this.fillRect(COLORS.white, 178, y, Math.max(1, Math.round(selected.genome[gene] * 16)), 3);
      });
    }

    // Life: the followed creature's energy, or the population's average.
    this.text('-LIFE-', 206, 6, COLORS.red);
    const energyFraction = selected
      ? selected.energy / config.creatures.maxEnergy
      : creatures.length === 0
        ? 0
        : creatures.reduce((sum, c) => sum + c.energy, 0) /
          creatures.length /
          config.creatures.maxEnergy;
    const hearts = heartsFor(energyFraction);
    for (let i = 0; i < HEART_COUNT; i++) {
      const x = 206 + (i % 5) * TILE;
      const y = 22 + Math.floor(i / 5) * 9;
      ctx.drawImage(atlas.hearts[hearts[i]], x, y);
    }
  }

  private drawSlot(x: number, y: number): void {
    this.fillRect(COLORS.blue, x, y, 24, 32);
    this.fillRect(COLORS.black, x + 2, y + 2, 20, 28);
  }

  private drawMinimapOverlay(sim: Simulation, view: ViewState, selected: Creature | null): void {
    const { ctx } = this;
    const { world } = sim;
    const scaleX = MINIMAP_SIZE / world.width;
    const scaleY = MINIMAP_SIZE / world.height;
    ctx.save();
    ctx.beginPath();
    ctx.rect(8, 4, MINIMAP_SIZE, MINIMAP_SIZE);
    ctx.clip();
    for (const c of sim.creatures) {
      const column = Math.min(HUE_COLUMN_COUNT - 1, Math.floor(c.traits.hue * HUE_COLUMN_COUNT));
      ctx.fillStyle = this.dotColors[column];
      ctx.fillRect(8 + Math.floor(c.x * scaleX), 4 + Math.floor(c.y * scaleY), 1, 1);
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
    if (selected && (this.frame >> 3) % 2 === 0) {
      ctx.fillStyle = css(COLORS.white);
      ctx.fillRect(
        8 + Math.floor(selected.x * scaleX) - 1,
        4 + Math.floor(selected.y * scaleY) - 1,
        3,
        3,
      );
    }
    ctx.restore();
  }

  private buildMinimap(world: World): Sprite {
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
