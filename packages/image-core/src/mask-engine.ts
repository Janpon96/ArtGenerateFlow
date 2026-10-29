/**
 * Mask drawing engine: pointer mapping, rectangle/lasso rasterization and undo/redo.
 * All coordinates are CSS pixels on the screen side and image pixels on the mask side.
 * Device pixel ratio is deliberately not an input: getBoundingClientRect and pointer
 * events are already in CSS pixels, so multiplying by DPR would shift every stroke.
 */

export interface PointerMapInput {
  clientX: number;
  clientY: number;
  /** getBoundingClientRect() of the canvas element, CSS px. */
  canvasRect: { left: number; top: number; width: number; height: number };
  /** CSS border widths of the canvas element (content box starts inside the border). */
  border?: { left: number; top: number; right: number; bottom: number };
  /** CSS px per image pixel. 1 = 100%. */
  zoom: number;
  /** Pan of the image centre from the content-box centre, CSS px. */
  pan: { x: number; y: number };
  image: { width: number; height: number };
}

export interface PixelPoint {
  /** Fractional image coordinates. */
  fx: number;
  fy: number;
  /** Integer pixel containing the point. */
  x: number;
  y: number;
  inside: boolean;
}

/**
 * client -> remove canvas offset and border -> invert pan/zoom (letterboxing is the centring) -> image pixel.
 */
export function clientToPixel(input: PointerMapInput): PixelPoint {
  const { canvasRect: r, image, zoom, pan } = input;
  if (!(zoom > 0) || !Number.isFinite(zoom)) throw new RangeError('Invalid zoom');
  const b = input.border ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const contentW = r.width - b.left - b.right;
  const contentH = r.height - b.top - b.bottom;
  const localX = input.clientX - r.left - b.left;
  const localY = input.clientY - r.top - b.top;
  const fx = (localX - contentW / 2 - pan.x) / zoom + image.width / 2;
  const fy = (localY - contentH / 2 - pan.y) / zoom + image.height / 2;
  const x = Math.floor(fx);
  const y = Math.floor(fy);
  return { fx, fy, x, y, inside: x >= 0 && y >= 0 && x < image.width && y < image.height };
}

/** Inverse of {@link clientToPixel}, used to draw overlays and in tests. */
export function pixelToClient(
  fx: number, fy: number,
  view: Omit<PointerMapInput, 'clientX' | 'clientY'>,
): { clientX: number; clientY: number } {
  const r = view.canvasRect;
  const b = view.border ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const contentW = r.width - b.left - b.right;
  const contentH = r.height - b.top - b.bottom;
  return {
    clientX: (fx - view.image.width / 2) * view.zoom + contentW / 2 + view.pan.x + r.left + b.left,
    clientY: (fy - view.image.height / 2) * view.zoom + contentH / 2 + view.pan.y + r.top + b.top,
  };
}

export type Shape =
  | { kind: 'rect'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'lasso'; points: ReadonlyArray<{ x: number; y: number }> }
  | { kind: 'brush'; points: ReadonlyArray<{ x: number; y: number }>; radius: number };

/** Stamps a filled disk (pixel centres within radius) at every sample along the polyline. */
function rasterizeBrush(
  pts: ReadonlyArray<{ x: number; y: number }>, radius: number, width: number, height: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  const r = Math.max(0.5, radius);
  const stamp = (cx: number, cy: number): void => {
    const ya = Math.max(0, Math.floor(cy - r));
    const yb = Math.min(height - 1, Math.ceil(cy + r));
    const xa = Math.max(0, Math.floor(cx - r));
    const xb = Math.min(width - 1, Math.ceil(cx + r));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) out[y * width + x] = 1;
      }
    }
  };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    if (i === 0) stamp(a.x, a.y);
    else {
      const p = pts[i - 1]!;
      const dist = Math.hypot(a.x - p.x, a.y - p.y);
      const steps = Math.max(1, Math.ceil(dist / Math.max(1, r / 2)));
      for (let s = 1; s <= steps; s++) stamp(p.x + ((a.x - p.x) * s) / steps, p.y + ((a.y - p.y) * s) / steps);
    }
  }
  return out;
}

/** Marks pixels whose centre lies in the shape. Lasso uses even-odd; rect is clamped to the image. */
export function rasterize(shape: Shape, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  if (shape.kind === 'rect') {
    const xa = Math.max(0, Math.ceil(Math.min(shape.x0, shape.x1) - 0.5));
    const xb = Math.min(width, Math.ceil(Math.max(shape.x0, shape.x1) - 0.5));
    const ya = Math.max(0, Math.ceil(Math.min(shape.y0, shape.y1) - 0.5));
    const yb = Math.min(height, Math.ceil(Math.max(shape.y0, shape.y1) - 0.5));
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) out[y * width + x] = 1;
    return out;
  }
  if (shape.kind === 'brush') return rasterizeBrush(shape.points, shape.radius, width, height);
  const pts = shape.points;
  if (pts.length < 3) return out;
  const xs: number[] = [];
  for (let y = 0; y < height; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const c = pts[(i + 1) % pts.length]!;
      if ((a.y <= cy) !== (c.y <= cy)) xs.push(a.x + ((cy - a.y) / (c.y - a.y)) * (c.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k]! - 0.5));
      const to = Math.min(width, Math.ceil(xs[k + 1]! - 0.5));
      for (let x = from; x < to; x++) out[y * width + x] = 1;
    }
  }
  return out;
}

export type PaintMode = 'add' | 'subtract';

/** One editable binary layer (allowed or protect) with bounded undo/redo snapshots. */
export class MaskLayer {
  private current: Uint8Array;
  private undoStack: Uint8Array[] = [];
  private redoStack: Uint8Array[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly maxHistory = 20,
    initial?: Uint8Array,
  ) {
    if (initial && initial.length !== width * height) throw new RangeError('Initial mask size mismatch');
    this.current = initial ? Uint8Array.from(initial) : new Uint8Array(width * height);
  }

  get data(): Readonly<Uint8Array> { return this.current; }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  apply(shape: Shape, mode: PaintMode): void {
    const stamp = rasterize(shape, this.width, this.height);
    const next = Uint8Array.from(this.current);
    for (let i = 0; i < next.length; i++) {
      if (stamp[i] === 1) next[i] = mode === 'add' ? 1 : 0;
    }
    this.push(next);
  }

  invert(): void {
    const next = Uint8Array.from(this.current);
    for (let i = 0; i < next.length; i++) next[i] = next[i] === 1 ? 0 : 1;
    this.push(next);
  }

  clear(): void { this.push(new Uint8Array(this.current.length)); }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.current);
    this.current = prev;
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.current);
    this.current = next;
    return true;
  }

  private push(next: Uint8Array): void {
    this.undoStack.push(this.current);
    if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
    this.redoStack = [];
    this.current = next;
  }
}
