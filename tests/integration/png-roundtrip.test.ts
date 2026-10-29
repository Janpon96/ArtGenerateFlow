import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { effectiveMask, featherInward, compositeRegion, verifyOutside } from '@frs/image-core';

function randomRgba(n: number, seed: number): Uint8Array {
  let s = seed >>> 0;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < out.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

// Encode the composite to PNG bytes, decode those exact bytes, then verify outside the mask.
function roundTrip(pixels: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const png = new PNG({ width: w, height: h, colorType: 6, inputColorType: 6, inputHasAlpha: true });
  png.data = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  const file = PNG.sync.write(png, { colorType: 6, inputColorType: 6, inputHasAlpha: true });
  const decoded = PNG.sync.read(file);
  expect(decoded.width).toBe(w);
  expect(decoded.height).toBe(h);
  return new Uint8Array(decoded.data);
}

describe('PNG round-trip preserves bytes outside the effective mask', () => {
  it('keeps hidden RGB at alpha=0 and semi-transparent pixels exactly', () => {
    const w = 16, h = 12, n = w * h;
    const base = randomRgba(n, 7);
    for (let p = 0; p < n; p += 5) base[p * 4 + 3] = 0; // transparent with hidden RGB
    for (let p = 1; p < n; p += 7) base[p * 4 + 3] = 128;
    const candidate = randomRgba(n, 99);
    const allowed = new Uint8Array(n);
    const protect = new Uint8Array(n);
    for (let y = 2; y < 9; y++) for (let x = 3; x < 13; x++) allowed[y * w + x] = 1;
    protect[5 * w + 7] = 1;
    const mask = effectiveMask(allowed, protect, w, h);
    const out = compositeRegion(base, candidate, mask, featherInward(mask, w, h, 3), w, h);
    const decoded = roundTrip(out, w, h);
    const report = verifyOutside(base, decoded, mask, w, h);
    expect(report.outsideChangedPixels).toBe(0);
    expect(report.maxOutsideChannelDelta).toBe(0);
    expect(report.outsidePixelCount).toBeGreaterThan(0);
  });

  it('detects tampering of the encoded file', () => {
    const w = 4, h = 4, n = w * h;
    const base = randomRgba(n, 3);
    const mask = new Uint8Array(n);
    mask[5] = 1;
    const out = compositeRegion(base, randomRgba(n, 4), mask, featherInward(mask, w, h, 0), w, h);
    const decoded = roundTrip(out, w, h);
    decoded[0] = (decoded[0]! + 1) & 255;
    expect(verifyOutside(base, decoded, mask, w, h).preserved).toBe(false);
  });
});
