import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { probeImage, pixelHash, findDuplicate, ImportRejected, LOCAL_LIMITS } from '@frs/image-core';

const png = (w: number, h: number) => new Uint8Array(PNG.sync.write(new PNG({ width: w, height: h })));
const text = (s: string) => new TextEncoder().encode(s);

function rejection(fn: () => unknown): ImportRejected {
  try { fn(); } catch (e) { if (e instanceof ImportRejected) return e; throw e; }
  throw new Error('expected ImportRejected');
}

/** Inserts an acTL chunk right after IHDR, which is what makes a PNG animated. */
function asApng(p: Uint8Array): Uint8Array {
  const actl = new Uint8Array([0, 0, 0, 8, 0x61, 0x63, 0x54, 0x4c, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
  const at = 8 + 12 + 13; // signature + IHDR chunk
  const out = new Uint8Array(p.length + actl.length);
  out.set(p.subarray(0, at), 0);
  out.set(actl, at);
  out.set(p.subarray(at), at + actl.length);
  return out;
}

function webpVp8x(animated: boolean, w: number, h: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set(text('RIFF'), 0);
  b.set(text('WEBP'), 8);
  b.set(text('VP8X'), 12);
  b[20] = animated ? 0x02 : 0;
  const w1 = w - 1, h1 = h - 1;
  b[24] = w1 & 255; b[25] = (w1 >> 8) & 255; b[26] = (w1 >> 16) & 255;
  b[27] = h1 & 255; b[28] = (h1 >> 8) & 255; b[29] = (h1 >> 16) & 255;
  return b;
}

describe('image import probe (REF-01)', () => {
  it('reads type and size from the bytes', () => {
    expect(probeImage(png(7, 5))).toEqual({ mimeType: 'image/png', width: 7, height: 5 });
    expect(probeImage(webpVp8x(false, 640, 480))).toEqual({ mimeType: 'image/webp', width: 640, height: 480 });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 20, 0, 30, 1, 1, 0x11, 0, 0xff, 0xd9]);
    expect(probeImage(jpeg)).toEqual({ mimeType: 'image/jpeg', width: 30, height: 20 });
  });

  it('ignores any file name or declared type: SVG is refused even when it is called .png', () => {
    expect(rejection(() => probeImage(text('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).code).toBe('SVG_NOT_ALLOWED');
    expect(rejection(() => probeImage(text('<?xml version="1.0"?><svg></svg>'))).code).toBe('SVG_NOT_ALLOWED');
  });

  it('rejects animated PNG and animated WebP', () => {
    expect(rejection(() => probeImage(asApng(png(4, 4)))).code).toBe('ANIMATED');
    expect(rejection(() => probeImage(webpVp8x(true, 4, 4))).code).toBe('ANIMATED');
  });

  it('rejects empty, unknown and truncated files', () => {
    expect(rejection(() => probeImage(new Uint8Array())).code).toBe('EMPTY');
    expect(rejection(() => probeImage(text('hello world, not an image'))).code).toBe('UNSUPPORTED_TYPE');
    const p = png(8, 8);
    expect(rejection(() => probeImage(p.subarray(0, p.length - 12))).code).toBe('CORRUPT');
  });

  it('enforces the local size and megapixel limits', () => {
    expect(rejection(() => probeImage(png(4, 4), { ...LOCAL_LIMITS, maxFileBytes: 10 })).code).toBe('TOO_LARGE');
    expect(rejection(() => probeImage(png(2000, 2000), { ...LOCAL_LIMITS, maxMegapixels: 3 })).code).toBe('TOO_MANY_PIXELS');
    expect(probeImage(png(1000, 1000), { ...LOCAL_LIMITS, maxMegapixels: 3 }).width).toBe(1000);
  });
});

describe('pixel hash and duplicates', () => {
  it('differs for the same bytes with different shapes, and for a single changed channel', async () => {
    const a = new Uint8Array(16);
    const wide = await pixelHash(4, 1, a);
    const tall = await pixelHash(1, 4, a);
    expect(wide).not.toBe(tall);
    const b = new Uint8Array(a);
    b[3] = 1;
    expect(await pixelHash(4, 1, b)).not.toBe(wide);
    expect(wide).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a buffer whose length does not match the dimensions', async () => {
    await expect(pixelHash(2, 2, new Uint8Array(15))).rejects.toBeInstanceOf(ImportRejected);
  });

  it('reports the existing asset for identical bytes', () => {
    const known = new Map([['h1', 'asset_1']]);
    expect(findDuplicate('h1', known)).toBe('asset_1');
    expect(findDuplicate('h2', known)).toBeNull();
  });
});
