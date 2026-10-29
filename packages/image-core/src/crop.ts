/**
 * Crop context (docs/05 5.1): bbox of the effective mask plus padding, clamped to the image.
 * The padding is context for the model only. It never enlarges the editable region.
 */

export interface Rect { x: number; y: number; w: number; h: number }

export const DEFAULT_PADDING_RATIO = 0.15;

export function maskBounds(mask: Uint8Array, width: number, height: number): Rect | null {
  if (mask.length !== width * height) throw new RangeError('Mask does not match dimensions');
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] !== 1) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export interface CropPlan {
  /** Rectangle in baseline pixels. */
  rect: Rect;
  bbox: Rect;
  paddingPx: number;
  paddingRatio: number;
}

export function planCrop(bbox: Rect, width: number, height: number, paddingRatio = DEFAULT_PADDING_RATIO): CropPlan {
  if (!(paddingRatio >= 0) || !Number.isFinite(paddingRatio)) throw new RangeError('Invalid padding ratio');
  const paddingPx = Math.round(Math.max(bbox.w, bbox.h) * paddingRatio);
  const x0 = Math.max(0, bbox.x - paddingPx);
  const y0 = Math.max(0, bbox.y - paddingPx);
  const x1 = Math.min(width, bbox.x + bbox.w + paddingPx);
  const y1 = Math.min(height, bbox.y + bbox.h + paddingPx);
  return { rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, bbox, paddingPx, paddingRatio };
}

export function extractRect(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, r: Rect): Uint8ClampedArray {
  assertRect(r, width, height);
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const from = ((r.y + y) * width + r.x) * 4;
    out.set(rgba.subarray(from, from + r.w * 4), y * r.w * 4);
  }
  return out;
}

function assertRect(r: Rect, width: number, height: number): void {
  if (r.w < 1 || r.h < 1 || r.x < 0 || r.y < 0 || r.x + r.w > width || r.y + r.h > height) {
    throw new RangeError('Rect outside image');
  }
}

/** Bilinear resample of a candidate. Only ever applied to candidates, never to the baseline. */
export function resampleRgba(
  src: Uint8Array | Uint8ClampedArray, sw: number, sh: number, dw: number, dh: number,
): Uint8ClampedArray {
  if (src.length !== sw * sh * 4) throw new RangeError('Source does not match dimensions');
  if (sw === dw && sh === dh) return new Uint8ClampedArray(src);
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, ((y + 0.5) * sh) / dh - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, ((x + 0.5) * sw) / dw - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const a = src[(y0 * sw + x0) * 4 + c]! * (1 - tx) + src[(y0 * sw + x1) * 4 + c]! * tx;
        const b = src[(y1 * sw + x0) * 4 + c]! * (1 - tx) + src[(y1 * sw + x1) * 4 + c]! * tx;
        out[(y * dw + x) * 4 + c] = Math.round(a * (1 - ty) + b * ty);
      }
    }
  }
  return out;
}

export class CandidateGeometryError extends Error {
  constructor(message: string) { super(message); }
}

/**
 * Maps a candidate to baseline geometry.
 * - full image: candidate must have the baseline size, otherwise it is rejected (no silent reframing).
 * - crop: candidate aspect must match the crop; it is resampled to the crop size and placed
 *   on a copy of the baseline at the crop origin.
 */
export function mapCandidateToBaseline(
  base: Uint8Array | Uint8ClampedArray, bw: number, bh: number,
  candidate: { width: number; height: number; rgba: Uint8Array | Uint8ClampedArray },
  crop: Rect | null,
  aspectTolerance = 0.01,
): Uint8ClampedArray {
  if (candidate.rgba.length !== candidate.width * candidate.height * 4) {
    throw new CandidateGeometryError('Candidate buffer does not match its dimensions.');
  }
  if (!crop || (crop.x === 0 && crop.y === 0 && crop.w === bw && crop.h === bh)) {
    if (candidate.width !== bw || candidate.height !== bh) {
      throw new CandidateGeometryError(
        `Candidate is ${candidate.width}x${candidate.height} but the baseline is ${bw}x${bh}. Reframed results are not accepted for Strict.`,
      );
    }
    return new Uint8ClampedArray(candidate.rgba);
  }
  assertRect(crop, bw, bh);
  const want = crop.w / crop.h;
  const got = candidate.width / candidate.height;
  if (Math.abs(got - want) / want > aspectTolerance) {
    throw new CandidateGeometryError('Candidate aspect ratio differs from the crop. The model reframed the image.');
  }
  const fitted = resampleRgba(candidate.rgba, candidate.width, candidate.height, crop.w, crop.h);
  const out = new Uint8ClampedArray(base);
  for (let y = 0; y < crop.h; y++) {
    out.set(fitted.subarray(y * crop.w * 4, (y + 1) * crop.w * 4), ((crop.y + y) * bw + crop.x) * 4);
  }
  return out;
}
