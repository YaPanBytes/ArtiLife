/**
 * Uniform-grid spatial index over a toroidal map, rebuilt each tick from
 * position arrays. Items are indices into the caller's arrays. Rebuilding with a
 * counting sort keeps it allocation-free after construction, and queries only look
 * at the cells a circle touches, so the cost depends on how many neighbours there are
 * and not on how many creatures exist.
 */
export class SpatialHash {
  private readonly cols: number;
  private readonly rows: number;
  private readonly invCellW: number;
  private readonly invCellH: number;
  private readonly cellStart: Int32Array;
  private readonly cursor: Int32Array;
  private cellOfItem: Int32Array;
  private items: Int32Array;
  private xs: ArrayLike<number> = new Float64Array(0);
  private ys: ArrayLike<number> = new Float64Array(0);

  constructor(
    private readonly width: number,
    private readonly height: number,
    cellSize: number,
    capacity = 1024,
  ) {
    this.cols = Math.max(1, Math.floor(width / cellSize));
    this.rows = Math.max(1, Math.floor(height / cellSize));
    this.invCellW = this.cols / width;
    this.invCellH = this.rows / height;
    this.cellStart = new Int32Array(this.cols * this.rows + 1);
    this.cursor = new Int32Array(this.cols * this.rows);
    this.cellOfItem = new Int32Array(capacity);
    this.items = new Int32Array(capacity);
  }

  private col(x: number): number {
    const c = Math.floor((x - this.width * Math.floor(x / this.width)) * this.invCellW);
    return c >= this.cols ? this.cols - 1 : c;
  }

  private row(y: number): number {
    const r = Math.floor((y - this.height * Math.floor(y / this.height)) * this.invCellH);
    return r >= this.rows ? this.rows - 1 : r;
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
    const { cellStart, cellOfItem, items, cursor, cols } = this;
    const cells = cols * this.rows;
    cellStart.fill(0);
    for (let i = 0; i < count; i++) {
      const cell = this.row(ys[i]) * cols + this.col(xs[i]);
      cellOfItem[i] = cell;
      cellStart[cell + 1]++;
    }
    for (let c = 0; c < cells; c++) cellStart[c + 1] += cellStart[c];
    // Place items using a per-cell write cursor.
    for (let c = 0; c < cells; c++) cursor[c] = cellStart[c];
    for (let i = 0; i < count; i++) items[cursor[cellOfItem[i]]++] = i;
  }

  /**
   * Push into `out` the indices of all items within `radius` of (x, y), using
   * shortest toroidal distance. Clears `out` first and returns it.
   */
  query(x: number, y: number, radius: number, out: number[] = []): number[] {
    out.length = 0;
    const { width, height, cols, rows, xs, ys, items, cellStart } = this;
    const wx = x - width * Math.floor(x / width);
    const wy = y - height * Math.floor(y / height);

    // The block of cells the circle's bounding box touches; if it spans the whole
    // map in an axis, visit each cell once.
    let c0 = Math.floor((wx - radius) * this.invCellW);
    let c1 = Math.floor((wx + radius) * this.invCellW);
    let r0 = Math.floor((wy - radius) * this.invCellH);
    let r1 = Math.floor((wy + radius) * this.invCellH);
    const allCols = c1 - c0 + 1 >= cols;
    const allRows = r1 - r0 + 1 >= rows;
    if (allCols) {
      c0 = 0;
      c1 = cols - 1;
    }
    if (allRows) {
      r0 = 0;
      r1 = rows - 1;
    }

    const r2 = radius * radius;
    const halfW = width * 0.5;
    const halfH = height * 0.5;
    for (let r = r0; r <= r1; r++) {
      const row = allRows ? r : r < 0 ? r + rows : r >= rows ? r - rows : r;
      for (let c = c0; c <= c1; c++) {
        const col = allCols ? c : c < 0 ? c + cols : c >= cols ? c - cols : c;
        const cell = row * cols + col;
        const end = cellStart[cell + 1];
        for (let k = cellStart[cell]; k < end; k++) {
          const i = items[k];
          let dx = xs[i] - wx;
          let dy = ys[i] - wy;
          // Positions can sit anywhere within a map-width of each other; fold into [-w/2, w/2].
          if (dx > halfW) dx -= width * Math.ceil((dx - halfW) / width);
          else if (dx < -halfW) dx += width * Math.ceil((-dx - halfW) / width);
          if (dy > halfH) dy -= height * Math.ceil((dy - halfH) / height);
          else if (dy < -halfH) dy += height * Math.ceil((-dy - halfH) / height);
          if (dx * dx + dy * dy <= r2) out.push(i);
        }
      }
    }
    return out;
  }
}
