import { describe, it, expect } from 'vitest';
import {
  clientToPixel, pixelToClient, rasterize, MaskLayer,
  maskBounds, planCrop, mapCandidateToBaseline, CandidateGeometryError, maskRevisionId,
} from '@frs/image-core';

const image = { width: 200, height: 100 };

describe('pointer mapping', () => {
  // zoom is CSS px per image px. DPR changes the backing store only, never these inputs.
  for (const zoom of [0.25, 1, 4]) {
    for (const dpr of [1, 1.25, 2]) {
      it(`round-trips at zoom ${zoom * 100}% and DPR ${dpr}`, () => {
        const view = {
          canvasRect: { left: 37.5, top: 12, width: 640, height: 480 },
          border: { left: 2, top: 2, right: 2, bottom: 2 },
          zoom, pan: { x: 10, y: -6 }, image,
        };
        // A backing store scaled by DPR must not change what the pointer maps to.
        const backingWidth = Math.round(view.canvasRect.width * dpr);
        expect(backingWidth / dpr).toBeCloseTo(view.canvasRect.width, 0);
        for (const [fx, fy] of [[0.5, 0.5], [100.5, 50.5], [199.5, 99.5]] as const) {
          const c = pixelToClient(fx, fy, view);
          const p = clientToPixel({ ...c, ...view });
          expect(p.fx).toBeCloseTo(fx, 6);
          expect(p.fy).toBeCloseTo(fy, 6);
          expect(p.x).toBe(Math.floor(fx));
        }
      });
    }
  }

  it('reports points in the letterbox as outside the image', () => {
    const view = { canvasRect: { left: 0, top: 0, width: 800, height: 600 }, zoom: 1, pan: { x: 0, y: 0 }, image };
    expect(clientToPixel({ ...view, clientX: 5, clientY: 300 }).inside).toBe(false);
    expect(clientToPixel({ ...view, clientX: 400, clientY: 300 }).inside).toBe(true);
  });
});

describe('rasterize', () => {
  it('lasso uses even-odd, so an inner loop drawn the same way is a hole', () => {
    const outer = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const inner = [{ x: 3, y: 3 }, { x: 7, y: 3 }, { x: 7, y: 7 }, { x: 3, y: 7 }];
    // Single self-touching polygon: outer ring, bridge to inner ring and back.
    const points = [...outer, outer[0]!, inner[0]!, inner[1]!, inner[2]!, inner[3]!, inner[0]!, outer[0]!];
    const m = rasterize({ kind: 'lasso', points }, 10, 10);
    expect(m[5 * 10 + 5]).toBe(0);
    expect(m[1 * 10 + 1]).toBe(1);
  });

  it('clamps a rectangle to the image and handles a one pixel area', () => {
    const m = rasterize({ kind: 'rect', x0: -5, y0: -5, x1: 1, y1: 1 }, 4, 4);
    expect(m.reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe('MaskLayer undo/redo', () => {
  it('restores earlier states and drops redo after a new edit', () => {
    const layer = new MaskLayer(4, 4);
    layer.apply({ kind: 'rect', x0: 0, y0: 0, x1: 2, y1: 2 }, 'add');
    const first = Uint8Array.from(layer.data);
    layer.apply({ kind: 'rect', x0: 2, y0: 2, x1: 4, y1: 4 }, 'add');
    expect(layer.undo()).toBe(true);
    expect([...layer.data]).toEqual([...first]);
    expect(layer.redo()).toBe(true);
    expect(layer.undo()).toBe(true);
    layer.apply({ kind: 'rect', x0: 3, y0: 3, x1: 4, y1: 4 }, 'add');
    expect(layer.canRedo).toBe(false);
  });
});

describe('mask revision binding', () => {
  it('differs when the baseline hash differs for the same mask', async () => {
    const mask = new Uint8Array(4).fill(1);
    expect(await maskRevisionId('a'.repeat(64), 2, 2, mask)).not.toBe(await maskRevisionId('b'.repeat(64), 2, 2, mask));
  });
});

describe('crop context', () => {
  it('pads 15% of the longer bbox edge and clamps to the image', () => {
    const plan = planCrop({ x: 10, y: 40, w: 100, h: 20 }, 200, 100);
    expect(plan.paddingPx).toBe(15);
    expect(plan.rect).toEqual({ x: 0, y: 25, w: 125, h: 50 });
  });

  it('finds no bounds for an empty mask', () => {
    expect(maskBounds(new Uint8Array(9), 3, 3)).toBeNull();
  });

  it('places a resampled candidate at the crop origin and leaves the rest of the baseline byte-equal', () => {
    const bw = 8, bh = 8;
    const base = new Uint8Array(bw * bh * 4).map((_, i) => i % 251);
    const crop = { x: 2, y: 2, w: 4, h: 4 };
    const cand = { width: 2, height: 2, rgba: new Uint8Array(2 * 2 * 4).fill(200) };
    const out = mapCandidateToBaseline(base, bw, bh, cand, crop);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const inside = x >= 2 && x < 6 && y >= 2 && y < 6;
      const i = (y * bw + x) * 4;
      if (inside) expect(out[i]).toBe(200);
      else expect([...out.subarray(i, i + 4)]).toEqual([...base.subarray(i, i + 4)]);
    }
  });

  it('rejects a reframed candidate instead of stretching it', () => {
    const base = new Uint8Array(8 * 8 * 4);
    const wide = { width: 8, height: 2, rgba: new Uint8Array(8 * 2 * 4) };
    expect(() => mapCandidateToBaseline(base, 8, 8, wide, { x: 0, y: 0, w: 4, h: 4 })).toThrow(CandidateGeometryError);
    expect(() => mapCandidateToBaseline(base, 8, 8, { width: 4, height: 4, rgba: new Uint8Array(64) }, null))
      .toThrow(CandidateGeometryError);
  });
});

describe('brush rasterization', () => {
  it('marks a disk around a single stamp', () => {
    const m = rasterize({ kind: 'brush', points: [{ x: 50, y: 50 }], radius: 5 }, 200, 100);
    expect(m[50 * 200 + 50]).toBe(1);
    expect(m[50 * 200 + 54]).toBe(1);
    expect(m[50 * 200 + 56]).toBe(0);
    expect(m[56 * 200 + 50]).toBe(0);
  });

  it('fills the gap between distant points', () => {
    const m = rasterize({ kind: 'brush', points: [{ x: 20, y: 50 }, { x: 120, y: 50 }], radius: 3 }, 200, 100);
    expect(m[50 * 200 + 70]).toBe(1);
    expect(m[50 * 200 + 130]).toBe(0);
    expect(m[60 * 200 + 70]).toBe(0);
  });

  it('clamps at the image edge without throwing', () => {
    const m = rasterize({ kind: 'brush', points: [{ x: -10, y: -10 }, { x: 5, y: 5 }], radius: 8 }, 200, 100);
    expect(m.length).toBe(200 * 100);
    expect(m[0]).toBe(1);
    expect(m[99 * 200 + 199]).toBe(0);
  });
});
