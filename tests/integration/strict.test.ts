import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import {
  runStrict, revalidateStrictFile, labelFor, strictBlockers, rasterize,
  type PngCodec,
} from '@frs/image-core';

const codec: PngCodec = {
  encoderVersion: 'pngjs/7 test',
  decoderVersion: 'pngjs/7 test',
  async encode(w, h, rgba) {
    const png = new PNG({ width: w, height: h });
    png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    return new Uint8Array(PNG.sync.write(png, { colorType: 6, inputColorType: 6, inputHasAlpha: true }));
  },
  async decode(bytes) {
    const d = PNG.sync.read(Buffer.from(bytes));
    return { width: d.width, height: d.height, rgba: new Uint8Array(d.data) };
  },
};

function pixels(n: number, seed: number): Uint8Array {
  let s = seed >>> 0;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < out.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; out[i] = s >>> 24; }
  return out;
}

const w = 24, h = 16;

function fixture() {
  const base = pixels(w * h, 3);
  for (let p = 0; p < w * h; p += 4) base[p * 4 + 3] = 0; // hidden RGB under alpha 0
  base[7 * 4 + 3] = 128;
  const candidate = pixels(w * h, 99);
  const mask = rasterize({ kind: 'rect', x0: 6, y0: 4, x1: 18, y1: 12 }, w, h);
  return { base, candidate, mask };
}

describe('Strict pipeline', () => {
  it('passes with a feathered mask and keeps every outside RGBA byte, including hidden RGB', async () => {
    const { base, candidate, mask } = fixture();
    const r = await runStrict({ width: w, height: h, base, candidate, mask, featherRadius: 3, codec });
    expect(r.report.passed).toBe(true);
    expect(r.label).toBe('strict');
    expect(r.report.outsideChangedPixels).toBe(0);
    expect(r.report.outsidePixelCount).toBe(w * h - mask.reduce((a, b) => a + b, 0));
    const decoded = await codec.decode(r.fileBytes);
    for (let p = 0; p < w * h; p++) {
      if (mask[p] === 1) continue;
      expect([...decoded.rgba.subarray(p * 4, p * 4 + 4)]).toEqual([...base.subarray(p * 4, p * 4 + 4)]);
    }
  });

  it('fails when the codec alters a pixel outside the mask', async () => {
    const { base, candidate, mask } = fixture();
    const lossy: PngCodec = {
      ...codec,
      async decode(bytes) {
        const d = await codec.decode(bytes);
        d.rgba[0] = (d.rgba[0]! + 1) & 255; // pixel 0 is outside the mask
        return d;
      },
    };
    const r = await runStrict({ width: w, height: h, base, candidate, mask, codec: lossy });
    expect(r.report.passed).toBe(false);
    expect(r.report.outsideChangedPixels).toBe(1);
    expect(r.label).toBe('not_verified');
  });

  it('labels a full-image mask as whole-image edit, not Strict', async () => {
    const { base, candidate } = fixture();
    const full = new Uint8Array(w * h).fill(1);
    const r = await runStrict({ width: w, height: h, base, candidate, mask: full, codec });
    expect(r.report.outsidePixelCount).toBe(0);
    expect(r.label).toBe('edit_whole_image');
    expect(labelFor({ ...r.report, passed: true })).toBe('edit_whole_image');
  });

  it('invalidates the report when the saved file bytes change', async () => {
    const { base, candidate, mask } = fixture();
    const r = await runStrict({ width: w, height: h, base, candidate, mask, codec });
    expect((await revalidateStrictFile(r.fileBytes, r.report, base, mask, codec)).valid).toBe(true);
    const tampered = Uint8Array.from(r.fileBytes);
    const at = tampered.length - 20;
    tampered[at] = tampered[at]! ^ 0xff;
    const res = await revalidateStrictFile(tampered, r.report, base, mask, codec);
    expect(res).toEqual({ valid: false, reason: 'FILE_CHANGED' });
  });

  it('invalidates the report when the mask or baseline differs', async () => {
    const { base, candidate, mask } = fixture();
    const r = await runStrict({ width: w, height: h, base, candidate, mask, codec });
    const other = Uint8Array.from(mask); other[0] = 1;
    expect((await revalidateStrictFile(r.fileBytes, r.report, base, other, codec)).reason).toBe('MASK_CHANGED');
    const base2 = Uint8Array.from(base); base2[1] = base2[1]! ^ 1;
    expect((await revalidateStrictFile(r.fileBytes, r.report, base2, mask, codec)).reason).toBe('BASE_CHANGED');
  });
});

describe('PNG-02 blockers', () => {
  it('blocks 16-bit, HDR and non-sRGB profiles; allows 8-bit sRGB', () => {
    expect(strictBlockers({ bitDepth: 8, hasIccProfile: false, iccIsSrgb: false, hdr: false })).toEqual([]);
    expect(strictBlockers({ bitDepth: 16, hasIccProfile: false, iccIsSrgb: false, hdr: false })).toContain('SOURCE_HIGH_BIT_DEPTH');
    expect(strictBlockers({ bitDepth: 8, hasIccProfile: true, iccIsSrgb: false, hdr: false })).toContain('SOURCE_WIDE_GAMUT');
    expect(strictBlockers({ bitDepth: 8, hasIccProfile: false, iccIsSrgb: false, hdr: true })).toContain('SOURCE_HDR');
  });
});
