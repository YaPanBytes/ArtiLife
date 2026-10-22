import type { SimConfig } from './config';
import type { Rng } from './rng';

export const enum Terrain {
  Ground = 0,
  Water = 1,
  Rock = 2,
}

/** Tileable value noise in [0, 1]: wraps seamlessly, so the toroidal map has no seams. */
function tileableNoise(width: number, height: number, scale: number, rng: Rng): Float32Array {
  const gw = Math.max(1, Math.round(width / scale));
  const gh = Math.max(1, Math.round(height / scale));
  const lattice = new Float32Array(gw * gh);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();

  const smooth = (t: number) => t * t * (3 - 2 * t);
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const fy = (y * gh) / height;
    const y0 = Math.floor(fy);
    const ty = smooth(fy - y0);
    const y1 = (y0 + 1) % gh;
    for (let x = 0; x < width; x++) {
      const fx = (x * gw) / width;
      const x0 = Math.floor(fx);
      const tx = smooth(fx - x0);
      const x1 = (x0 + 1) % gw;
      const top = lattice[y0 * gw + x0] * (1 - tx) + lattice[y0 * gw + x1] * tx;
      const bottom = lattice[y1 * gw + x0] * (1 - tx) + lattice[y1 * gw + x1] * tx;
      out[y * width + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return out;
}

/** The value below which `fraction` of the samples fall. */
function quantile(values: Float32Array, fraction: number): number {
  const sorted = Float32Array.from(values).sort();
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index];
}

/**
 * The map: a toroidal tile grid with terrain, a per-tile fertility, and a food
 * field that regrows over time. Positions are continuous, 1 unit = 1 tile.
 */
export class World {
  readonly width: number;
  readonly height: number;
  readonly terrain: Uint8Array;
  /** Regrowth multiplier per tile (0 for water and rock). */
  readonly fertility: Float32Array;
  /** Plant energy per tile. */
  readonly food: Float32Array;
  private readonly config: SimConfig;

  constructor(config: SimConfig, rng: Rng) {
    this.config = config;
    this.width = config.world.width;
    this.height = config.world.height;
    const size = this.width * this.height;
    this.terrain = new Uint8Array(size);
    this.fertility = new Float32Array(size);
    this.food = new Float32Array(size);
    this.generate(rng.fork());
  }

  private generate(rng: Rng): void {
    const { width, height } = this;
    const { scale, waterFraction, rockFraction, fertilityContrast } = this.config.terrain;
    const elevation = tileableNoise(width, height, scale, rng);
    const fertilityNoise = tileableNoise(width, height, scale, rng);

    // Lowest tiles become water, highest become rock, so the fractions are exact.
    const waterLevel = waterFraction > 0 ? quantile(elevation, waterFraction) : -1;
    const rockLevel = rockFraction > 0 ? quantile(elevation, 1 - rockFraction) : 2;

    for (let i = 0; i < elevation.length; i++) {
      const e = elevation[i];
      if (waterFraction > 0 && e < waterLevel) this.terrain[i] = Terrain.Water;
      else if (rockFraction > 0 && e >= rockLevel) this.terrain[i] = Terrain.Rock;
      else this.terrain[i] = Terrain.Ground;

      if (this.terrain[i] === Terrain.Ground) {
        this.fertility[i] = 1 - fertilityContrast + fertilityContrast * fertilityNoise[i];
        this.food[i] =
          this.config.food.maxPerTile * this.config.food.initialFill * this.fertility[i];
      }
    }
    this.buildBarriers(rng);
  }

  /**
   * Walls of water or rock running top to bottom, evenly spaced, each two tiles
   * wide and broken by a few gaps. Together with the map wrapping around, two
   * barriers split the world into two regions joined only through the gaps.
   */
  private buildBarriers(rng: Rng): void {
    const { barrier, barrierCount, barrierGaps } = this.config.terrain;
    if (barrier === 'none') return;
    const kind = barrier === 'river' ? Terrain.Water : Terrain.Rock;
    const gapHeight = 3;
    for (let b = 0; b < barrierCount; b++) {
      const x0 = Math.floor(((b + 0.5) * this.width) / barrierCount);
      const gapAt = new Set<number>();
      for (let g = 0; g < barrierGaps; g++) {
        const top = rng.int(this.height);
        for (let k = 0; k < gapHeight; k++) gapAt.add((top + k) % this.height);
      }
      for (let y = 0; y < this.height; y++) {
        if (gapAt.has(y)) continue;
        for (let dx = 0; dx < 2; dx++) {
          const i = y * this.width + ((x0 + dx) % this.width);
          this.terrain[i] = kind;
          this.fertility[i] = 0;
          this.food[i] = 0;
        }
      }
    }
  }

  /** Index of the tile containing (x, y), wrapping around the map edges. */
  tileIndex(x: number, y: number): number {
    const tx = ((Math.floor(x) % this.width) + this.width) % this.width;
    const ty = ((Math.floor(y) % this.height) + this.height) % this.height;
    return ty * this.width + tx;
  }

  /** Wrap a coordinate pair into [0, width) x [0, height). */
  wrapX(x: number): number {
    return ((x % this.width) + this.width) % this.width;
  }

  wrapY(y: number): number {
    return ((y % this.height) + this.height) % this.height;
  }

  /** Shortest signed offset from `from` to `to` along x, accounting for wrap-around. */
  deltaX(from: number, to: number): number {
    const d = this.wrapX(to - from);
    return d > this.width / 2 ? d - this.width : d;
  }

  deltaY(from: number, to: number): number {
    const d = this.wrapY(to - from);
    return d > this.height / 2 ? d - this.height : d;
  }

  /** Squared shortest distance between two points on the torus. */
  distanceSq(x1: number, y1: number, x2: number, y2: number): number {
    const dx = this.deltaX(x1, x2);
    const dy = this.deltaY(y1, y2);
    return dx * dx + dy * dy;
  }

  terrainAt(x: number, y: number): Terrain {
    return this.terrain[this.tileIndex(x, y)];
  }

  /** Creatures can stand on ground only. */
  isWalkable(x: number, y: number): boolean {
    return this.terrainAt(x, y) === Terrain.Ground;
  }

  foodAt(x: number, y: number): number {
    return this.food[this.tileIndex(x, y)];
  }

  /** Remove up to `amount` plant energy from the tile at (x, y). Returns what was taken. */
  eat(x: number, y: number, amount: number): number {
    const i = this.tileIndex(x, y);
    const taken = Math.min(this.food[i], Math.max(0, amount));
    this.food[i] -= taken;
    return taken;
  }

  /** Multiplier on regrowth at a given tick: 1 without seasons, a sine swing with them. */
  seasonFactor(tick: number): number {
    const { enabled, lengthTicks, amplitude } = this.config.food.seasons;
    if (!enabled) return 1;
    return 1 + amplitude * Math.sin((2 * Math.PI * tick) / lengthTicks);
  }

  /** Regrow food on every tile for one tick. `boost` scales regrowth, for droughts and the like. */
  stepFood(tick: number, boost = 1): void {
    const { maxPerTile, regrowRate } = this.config.food;
    const rate = regrowRate * this.seasonFactor(tick) * boost;
    const { food, fertility } = this;
    for (let i = 0; i < food.length; i++) {
      const f = fertility[i];
      if (f > 0) food[i] = Math.min(maxPerTile, food[i] + rate * f);
    }
  }
}
