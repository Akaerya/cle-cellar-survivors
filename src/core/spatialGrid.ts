/**
 * Uniform grid rebuilt every frame. Used for the enemy push-apart pass and for area hit queries,
 * which stays cheap with hundreds of enemies where enemy-vs-enemy physics would not.
 */
export interface GridItem {
  x: number;
  y: number;
  active: boolean;
}

const FORWARD_X = [1, -1, 0, 1];
const FORWARD_Y = [0, 1, 1, 1];

export class SpatialGrid<T extends GridItem> {
  readonly cellSize: number;
  private cols: number;
  private rows: number;
  private cells: T[][];
  private used: number[] = [];

  constructor(width: number, height: number, cellSize = 64) {
    this.cellSize = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.cells = new Array(this.cols * this.rows);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
  }

  clear(): void {
    for (const i of this.used) this.cells[i].length = 0;
    this.used.length = 0;
  }

  insert(item: T): void {
    const cx = Math.min(this.cols - 1, Math.max(0, (item.x / this.cellSize) | 0));
    const cy = Math.min(this.rows - 1, Math.max(0, (item.y / this.cellSize) | 0));
    const idx = cy * this.cols + cx;
    const cell = this.cells[idx];
    if (cell.length === 0) this.used.push(idx);
    cell.push(item);
  }

  /** Appends every item whose cell touches the circle to `out` (caller does the exact distance test). */
  query(x: number, y: number, r: number, out: T[]): T[] {
    const cs = this.cellSize;
    const x0 = Math.max(0, ((x - r) / cs) | 0);
    const y0 = Math.max(0, ((y - r) / cs) | 0);
    const x1 = Math.min(this.cols - 1, ((x + r) / cs) | 0);
    const y1 = Math.min(this.rows - 1, ((y + r) / cs) | 0);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const cell = this.cells[cy * this.cols + cx];
        for (let i = 0; i < cell.length; i++) out.push(cell[i]);
      }
    }
    return out;
  }

  /** Calls fn for every pair of items in the same or neighbouring cells, each pair once. */
  forEachNeighbourPair(fn: (a: T, b: T) => void): void {
    const cols = this.cols;
    const rows = this.rows;
    for (const idx of this.used) {
      const cell = this.cells[idx];
      const cx = idx % cols;
      const cy = (idx / cols) | 0;
      for (let i = 0; i < cell.length; i++) {
        const a = cell[i];
        for (let j = i + 1; j < cell.length; j++) fn(a, cell[j]);
      }
      // Forward neighbours only (E, SW, S, SE) so each pair is visited once.
      for (let n = 0; n < 4; n++) {
        const nx = cx + FORWARD_X[n];
        const ny = cy + FORWARD_Y[n];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const other = this.cells[ny * cols + nx];
        if (other.length === 0) continue;
        for (let i = 0; i < cell.length; i++) {
          const a = cell[i];
          for (let j = 0; j < other.length; j++) fn(a, other[j]);
        }
      }
    }
  }
}
