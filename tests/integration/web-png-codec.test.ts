import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { webPngCodec, UnsupportedPngError } from '@frs/image-core';

function pixels(n: number, seed: number): Uint8Array {
  let s = seed >>> 0;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < out.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; out[i] = s >>> 24; }
  return out;
}

const w = 33, h = 21;

function pngjsWrite(rgba: Uint8Array, opts: Record<string, unknown>): Uint8Array {
  const png = new PNG({ width: w, height: h });
  png.data = Buffer.from(rgba);
  return new Uint8Array(PNG.sync.write(png, opts));
}

describe('web PNG codec (browser Strict codec)', () => {
  it('round-trips RGBA exactly, including RGB hidden under alpha 0', async () => {
    const rgba = pixels(w * h, 5);
    for (let p = 0; p < w * h; p += 3) rgba[p * 4 + 3] = 0;
    const decoded = await webPngCodec.decode(await webPngCodec.encode(w, h, new Uint8ClampedArray(rgba)));
    expect(decoded.width).toBe(w);
    expect(decoded.height).toBe(h);
    expect(Buffer.from(decoded.rgba).equals(Buffer.from(rgba))).toBe(true);
  });

  it('writes files that an independent decoder reads back identically', async () => {
    const rgba = pixels(w * h, 6);
    const bytes = await webPngCodec.encode(w, h, new Uint8ClampedArray(rgba));
    const d = PNG.sync.read(Buffer.from(bytes));
    expect([d.width, d.height]).toEqual([w, h]);
    expect(Buffer.from(d.data).equals(Buffer.from(rgba))).toBe(true);
  });

  it.each([0, 1, 2, 3, 4])('reads PNG rows written with filter type %i', async (filterType) => {
    const rgba = pixels(w * h, 7);
    const bytes = pngjsWrite(rgba, { colorType: 6, inputColorType: 6, inputHasAlpha: true, filterType });
    const decoded = await webPngCodec.decode(bytes);
    expect(Buffer.from(decoded.rgba).equals(Buffer.from(rgba))).toBe(true);
  });

  it('reads RGB (colour type 2) with opaque alpha', async () => {
    const rgba = pixels(w * h, 8);
    for (let p = 0; p < w * h; p++) rgba[p * 4 + 3] = 255;
    const bytes = pngjsWrite(rgba, { colorType: 2, inputColorType: 6, inputHasAlpha: true });
    const decoded = await webPngCodec.decode(bytes);
    expect(Buffer.from(decoded.rgba).equals(Buffer.from(rgba))).toBe(true);
  });

  it('rejects 16-bit, a corrupted chunk and non-PNG input instead of guessing', async () => {
    const rgba = pixels(w * h, 9);
    const sixteen = pngjsWrite(rgba, { colorType: 6, inputColorType: 6, inputHasAlpha: true, bitDepth: 16 });
    await expect(webPngCodec.decode(sixteen)).rejects.toBeInstanceOf(UnsupportedPngError);

    const good = await webPngCodec.encode(w, h, new Uint8ClampedArray(rgba));
    const bad = good.slice();
    bad[bad.length - 20] = (bad[bad.length - 20]! ^ 0xff) & 255; // flip a byte inside IDAT
    await expect(webPngCodec.decode(bad)).rejects.toBeInstanceOf(UnsupportedPngError);

    await expect(webPngCodec.decode(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).rejects.toBeInstanceOf(UnsupportedPngError);
  });
});
