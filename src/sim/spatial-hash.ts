/**
 * Uniform-grid spatial index over a toroidal map, rebuilt each tick from
 * position arrays. Items are indices into the caller's arrays. Rebuilding with a
 * counting sort keeps it allocation-free after construction.
 */
export class SpatialHash {
  private readonly cols: number;
  private readonly rows: number;
  private readonly cellStart: Int32Array;
  private cellOfItem: Int32Array;
  private items: Int32Array;
  private xs: ArrayLike<number> = [];
  private ys: ArrayLike<number> = [];

  constructor(
    private readonly width: number,
    private readonly height: number,
    cellSize: number,
    capacity = 1024,
  ) {
    this.cols = Math.max(1, Math.floor(width / cellSize));
    this.rows = Math.max(1, Math.floor(height / cellSize));
    this.cellStart = new Int32Array(this.cols * this.rows + 1);
    this.cellOfItem = new Int32Array(capacity);
    this.items = new Int32Array(capacity);
  }

  private col(x: number): number {
    const c = Math.floor((((x % this.width) + this.width) % this.width) / (this.width / this.cols));
    return Math.min(c, this.cols - 1);
  }

  private row(y: number): number {
    const r = Math.floor(
      (((y % this.height) + this.height) % this.height) / (this.height / this.rows),
    );
    return Math.min(r, this.rows - 1);
  }

  /** Index `count` items whose positions are xs[i], ys[i]. Arrays are kept by reference until the next build. */
  build(xs: ArrayLike<number>, ys: ArrayLike<number>, count: number): void {
    if (count > this.items.length) {
      const capacity = Math.max(count, this.items.length * 2);
      this.items = new Int32Array(capacity);
      this.cellOfItem = new Int32Array(capacity);
    }
    this.xs = xs;
    this.ys = ys;
    const { cellStart, cellOfItem, items, cols } = this;
    cellStart.fill(0);
    for (let i = 0; i < count; i++) {
      const cell = this.row(ys[i]) * cols + this.col(xs[i]);
      cellOfItem[i] = cell;
      cellStart[cell + 1]++;
    }
    for (let c = 0; c < cols * this.rows; c++) cellStart[c + 1] += cellStart[c];
    // Place items using a per-cell write cursor.
    const cursor = cellStart.slice(0, cols * this.rows);
    for (let i = 0; i < count; i++) items[cursor[cellOfItem[i]]++] = i;
  }

  /** Cell indices along one axis covering [centre - radius, centre + radius], wrapped and deduplicated. */
  private span(centre: number, radius: number, size: number, n: number, out: number[]): void {
    out.length = 0;
    const lo = Math.floor((centre - radius) / size);
    const hi = Math.floor((centre + radius) / size);
    if (hi - lo + 1 >= n) {
      for (let i = 0; i < n; i++) out.push(i);
      return;
    }
    for (let i = lo; i <= hi; i++) out.push(((i % n) + n) % n);
  }

  private readonly colBuf: number[] = [];
  private readonly rowBuf: number[] = [];

  /**
   * Push into `out` the indices of all items within `radius` of (x, y), using
   * shortest toroidal distance. Clears `out` first and returns it.
   */
  query(x: number, y: number, radius: number, out: number[] = []): number[] {
    out.length = 0;
    const cw = this.width / this.cols;
    const ch = this.height / this.rows;
    this.span(this.wrapPos(x, this.width), radius, cw, this.cols, this.colBuf);
    this.span(this.wrapPos(y, this.height), radius, ch, this.rows, this.rowBuf);
    const r2 = radius * radius;
    const { xs, ys, items, cellStart } = this;
    for (const row of this.rowBuf) {
      for (const col of this.colBuf) {
        const cell = row * this.cols + col;
        for (let k = cellStart[cell]; k < cellStart[cell + 1]; k++) {
          const i = items[k];
          let dx = Math.abs(xs[i] - x) % this.width;
          let dy = Math.abs(ys[i] - y) % this.height;
          if (dx > this.width / 2) dx = this.width - dx;
          if (dy > this.height / 2) dy = this.height - dy;
          if (dx * dx + dy * dy <= r2) out.push(i);
        }
      }
    }
    return out;
  }

  private wrapPos(v: number, size: number): number {
    return ((v % size) + size) % size;
  }
}
