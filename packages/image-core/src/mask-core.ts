/**
 * Pure RGBA mask/composite core, ported from Flow_Reference_Studio_Kit/reference/mask_core.mjs.
 * Candidate must already be mapped to baseline geometry.
 * Every mask value is 0 or 1; weights are in [0,1].
 */
type Bytes = Uint8Array | Uint8ClampedArray;

export const MAX_PIXELS = 24_000_000;

function pixelCount(width: number, height: number): number {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new RangeError('Invalid image dimensions');
  }
  const count = width * height;
  if (!Number.isSafeInteger(count) || count > MAX_PIXELS) {
    throw new RangeError('Pixel limit exceeded');
  }
  return count;
}

function binaryMask(mask: Bytes, count: number, label: string): void {
  if (!(mask instanceof Uint8Array || mask instanceof Uint8ClampedArray) || mask.length !== count) {
    throw new TypeError(`${label} must be a byte mask with exactly width*height values`);
  }
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 0 && mask[i] !== 1) throw new RangeError(`${label} must be binary 0/1`);
  }
}

function rgba(bytes: Bytes, count: number, label: string): void {
  if (!(bytes instanceof Uint8Array || bytes instanceof Uint8ClampedArray) || bytes.length !== count * 4) {
    throw new TypeError(`${label} must be RGBA8 with matching dimensions`);
  }
}

/** A = U AND NOT P. Protect always wins. */
export function effectiveMask(allowed: Bytes, protectedMask: Bytes, width: number, height: number): Uint8Array {
  const count = pixelCount(width, height);
  binaryMask(allowed, count, 'allowed');
  binaryMask(protectedMask, count, 'protected');
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) out[i] = allowed[i] === 1 && protectedMask[i] === 0 ? 1 : 0;
  return out;
}

/** Inward-only feather. Pixels with mask 0 always get weight 0. Image bounds count as outside. */
export function featherInward(mask: Bytes, width: number, height: number, radius = 0): Float32Array {
  const count = pixelCount(width, height);
  binaryMask(mask, count, 'mask');
  if (!Number.isFinite(radius) || radius < 0) throw new RangeError('Invalid feather radius');
  const weights = new Float32Array(count);
  if (radius === 0) {
    for (let i = 0; i < count; i++) weights[i] = mask[i]!;
    return weights;
  }
  const distances = new Int32Array(count).fill(-1);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < count; i++) {
    if (mask[i] === 0) {
      distances[i] = 0;
      queue[tail++] = i;
    }
  }
  for (let i = 0; i < count; i++) {
    const x = i % width;
    const y = Math.floor(i / width);
    if (mask[i] === 1 && (x === 0 || y === 0 || x === width - 1 || y === height - 1)) {
      distances[i] = 1;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++]!;
    const x = i % width;
    const d = distances[i]!;
    const visit = (next: number) => {
      if (distances[next] !== -1) return;
      distances[next] = d + 1;
      queue[tail++] = next;
    };
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i + width < count) visit(i + width);
  }
  for (let i = 0; i < count; i++) {
    if (mask[i] === 0) continue;
    const t = Math.min(1, Math.max(0, (distances[i]! - 0.5) / radius));
    weights[i] = t * t * (3 - 2 * t);
  }
  return weights;
}

export function compositeRegion(
  base: Bytes, candidate: Bytes, mask: Bytes,
  weights: Float32Array | Float64Array, width: number, height: number,
): Uint8ClampedArray {
  const count = pixelCount(width, height);
  rgba(base, count, 'base');
  rgba(candidate, count, 'candidate');
  binaryMask(mask, count, 'mask');
  if (!(weights instanceof Float32Array || weights instanceof Float64Array) || weights.length !== count) {
    throw new TypeError('weights must be a float array matching the mask');
  }
  const out = new Uint8ClampedArray(base); // exact byte copy, including transparent RGB
  for (let p = 0; p < count; p++) {
    const m = weights[p]!;
    if (!Number.isFinite(m) || m < 0 || m > 1) throw new RangeError('Weight outside [0,1]');
    if (mask[p] === 0) {
      if (m !== 0) throw new RangeError('Weight leaks outside effective mask');
      continue;
    }
    if (m === 0) continue;
    const i = p * 4;
    if (m === 1) {
      out.set(candidate.subarray(i, i + 4), i);
      continue;
    }
    const ba = base[i + 3]! / 255;
    const ca = candidate[i + 3]! / 255;
    const oa = (1 - m) * ba + m * ca;
    for (let c = 0; c < 3; c++) {
      out[i + c] = oa === 0 ? 0 : Math.round(((1 - m) * ba * base[i + c]! + m * ca * candidate[i + c]!) / oa);
    }
    out[i + 3] = Math.round(oa * 255);
  }
  return out;
}

export interface OutsideReport {
  outsidePixelCount: number;
  outsideChangedPixels: number;
  maxOutsideChannelDelta: number;
  preserved: boolean;
  hasOutsideRegion: boolean;
}

export function verifyOutside(
  base: Bytes, exportedDecodedPixels: Bytes, mask: Bytes, width: number, height: number,
): OutsideReport {
  const count = pixelCount(width, height);
  rgba(base, count, 'base');
  rgba(exportedDecodedPixels, count, 'output');
  binaryMask(mask, count, 'mask');
  let outsidePixelCount = 0;
  let outsideChangedPixels = 0;
  let maxOutsideChannelDelta = 0;
  for (let p = 0; p < count; p++) {
    if (mask[p] === 1) continue;
    outsidePixelCount++;
    let changed = false;
    for (let c = 0; c < 4; c++) {
      const delta = Math.abs(base[p * 4 + c]! - exportedDecodedPixels[p * 4 + c]!);
      if (delta !== 0) changed = true;
      if (delta > maxOutsideChannelDelta) maxOutsideChannelDelta = delta;
    }
    if (changed) outsideChangedPixels++;
  }
  return {
    outsidePixelCount,
    outsideChangedPixels,
    maxOutsideChannelDelta,
    preserved: outsideChangedPixels === 0,
    hasOutsideRegion: outsidePixelCount > 0,
  };
}
