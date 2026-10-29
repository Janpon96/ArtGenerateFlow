import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveMask, featherInward, compositeRegion, verifyOutside } from './mask_core.mjs';

const bytes = (count, color) => Uint8Array.from({ length: count * 4 }, (_, i) => color[i % 4]);
const compose = (base, candidate, mask, w, h, radius = 0) =>
  compositeRegion(base, candidate, mask, featherInward(mask, w, h, radius), w, h);

test('hard mask replaces selected pixels and preserves every outside RGBA byte', () => {
  const base = bytes(6, [20, 40, 60, 255]);
  const candidate = bytes(6, [200, 100, 50, 127]);
  const mask = Uint8Array.of(0, 1, 0, 0, 1, 0);
  const out = compose(base, candidate, mask, 3, 2);
  assert.deepEqual([...out.slice(4, 8)], [200, 100, 50, 127]);
  assert.deepEqual(verifyOutside(base, out, mask, 3, 2), {
    outsidePixelCount: 4, outsideChangedPixels: 0, maxOutsideChannelDelta: 0,
    preserved: true, hasOutsideRegion: true
  });
});

test('protect wins and creates a hole in the effective editable region', () => {
  const allowed = new Uint8Array(25).fill(1);
  const protect = new Uint8Array(25); protect[12] = 1;
  const mask = effectiveMask(allowed, protect, 5, 5);
  const weights = featherInward(mask, 5, 5, 3);
  assert.equal(mask[12], 0); assert.equal(weights[12], 0);
  const base = bytes(25, [31, 41, 51, 0]);
  const out = compositeRegion(base, bytes(25, [255, 0, 1, 255]), mask, weights, 5, 5);
  assert.deepEqual([...out.slice(48, 52)], [31, 41, 51, 0]);
  assert.equal(verifyOutside(base, out, mask, 5, 5).outsideChangedPixels, 0);
});

test('inward feather remains zero outside and increases toward the center', () => {
  const mask = new Uint8Array(81);
  for (let y = 1; y < 8; y++) for (let x = 1; x < 8; x++) mask[y * 9 + x] = 1;
  const weights = featherInward(mask, 9, 9, 3);
  assert.equal(weights[0], 0);
  assert.ok(weights[10] > 0 && weights[10] < weights[40]);
  assert.equal(weights[40], 1);
  for (let p = 0; p < 81; p++) if (!mask[p]) assert.equal(weights[p], 0);
});

test('premultiplied alpha avoids a dark fringe when fading from transparent RGB', () => {
  const base = Uint8Array.of(9, 17, 31, 0);
  const candidate = Uint8Array.of(0, 0, 255, 255);
  const out = compositeRegion(base, candidate, Uint8Array.of(1), Float32Array.of(0.5), 1, 1);
  assert.deepEqual([...out], [0, 0, 255, 128]);
});

test('semi-transparent colors blend with an explicitly testable expected value', () => {
  const out = compositeRegion(Uint8Array.of(255, 0, 0, 128), Uint8Array.of(0, 0, 255, 128),
    Uint8Array.of(1), Float32Array.of(0.5), 1, 1);
  assert.deepEqual([...out], [128, 0, 128, 128]);
});

test('zero weight and outside preserve hidden RGB exactly even at zero alpha', () => {
  const base = Uint8Array.of(23, 45, 67, 0, 98, 76, 54, 0);
  const out = compositeRegion(base, bytes(2, [1, 2, 3, 255]), Uint8Array.of(0, 1),
    Float32Array.of(0, 0), 2, 1);
  assert.deepEqual(out, new Uint8ClampedArray(base));
});

test('a single-pixel region edits only that pixel', () => {
  const base = bytes(9, [0, 0, 0, 255]);
  const mask = new Uint8Array(9); mask[4] = 1;
  const out = compose(base, bytes(9, [255, 255, 255, 255]), mask, 3, 3);
  assert.equal(out[16], 255);
  assert.equal(verifyOutside(base, out, mask, 3, 3).outsidePixelCount, 8);
  assert.equal(verifyOutside(base, out, mask, 3, 3).preserved, true);
});

test('empty effective mask is a safe no-op in core; UI must block costly generation', () => {
  const base = bytes(4, [1, 2, 3, 4]);
  const mask = effectiveMask(new Uint8Array(4).fill(1), new Uint8Array(4).fill(1), 2, 2);
  const out = compose(base, bytes(4, [5, 6, 7, 8]), mask, 2, 2, 5);
  assert.deepEqual(out, new Uint8ClampedArray(base));
});

test('full-image mask reports there is no outside region to label as preserved', () => {
  const mask = new Uint8Array(4).fill(1);
  const report = verifyOutside(bytes(4, [0, 0, 0, 0]), bytes(4, [255, 0, 0, 255]), mask, 2, 2);
  assert.equal(report.outsidePixelCount, 0);
  assert.equal(report.hasOutsideRegion, false);
});

test('verifier catches corruption in outside alpha and color', () => {
  const base = bytes(3, [50, 60, 70, 80]);
  const mask = Uint8Array.of(0, 1, 0);
  const corrupted = new Uint8Array(base); corrupted[3] += 2; corrupted[8] += 1;
  const report = verifyOutside(base, corrupted, mask, 3, 1);
  assert.equal(report.outsideChangedPixels, 2);
  assert.equal(report.maxOutsideChannelDelta, 2);
  assert.equal(report.preserved, false);
});

test('core rejects shape mismatch, nonbinary masks and invalid radii', () => {
  assert.throws(() => featherInward(Uint8Array.of(1), 2, 2), /width\*height/);
  assert.throws(() => featherInward(Uint8Array.of(255), 1, 1), /binary/);
  assert.throws(() => featherInward(Uint8Array.of(1), 1, 1, -1), /radius/);
  assert.throws(() => featherInward(Uint8Array.of(1), 1, 1, Infinity), /radius/);
  assert.throws(() => compose(bytes(1, [1,2,3,4]), bytes(2, [1,2,3,4]), Uint8Array.of(1), 1, 1), /RGBA8/);
});

test('core rejects alpha that leaks outside mask or contains invalid values', () => {
  const b = bytes(1, [1,2,3,4]);
  assert.throws(() => compositeRegion(b, b, Uint8Array.of(0), Float32Array.of(0.01), 1, 1), /leaks/);
  for (const v of [NaN, -0.1, 1.1, Infinity]) {
    assert.throws(() => compositeRegion(b, b, Uint8Array.of(1), Float32Array.of(v), 1, 1), /Weight/);
  }
});

test('inputs are immutable and disconnected regions preserve all gaps', () => {
  const base = bytes(16, [42, 0, 7, 128]);
  const saved = new Uint8Array(base);
  const candidate = bytes(16, [255, 20, 70, 255]);
  const mask = new Uint8Array(16); mask[0] = 1; mask[15] = 1;
  const out = compose(base, candidate, mask, 4, 4, 2);
  assert.deepEqual(base, saved);
  assert.equal(verifyOutside(base, out, mask, 4, 4).outsideChangedPixels, 0);
});

test('300 seeded randomized cases preserve every outside byte, including protected pixels', () => {
  let seed = 123456789;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let trial = 0; trial < 300; trial++) {
    const w = 1 + next() % 19, h = 1 + next() % 17, n = w * h;
    const base = Uint8Array.from({ length: n * 4 }, () => next() >>> 24);
    const candidate = Uint8Array.from({ length: n * 4 }, () => next() >>> 24);
    const allowed = Uint8Array.from({ length: n }, () => (next() >>> 24) % 2);
    const protect = Uint8Array.from({ length: n }, () => (next() >>> 24) % 5 === 0 ? 1 : 0);
    const mask = effectiveMask(allowed, protect, w, h);
    const out = compose(base, candidate, mask, w, h, [0, 1, 3, 6][trial % 4]);
    assert.equal(verifyOutside(base, out, mask, w, h).outsideChangedPixels, 0);
    for (let p = 0; p < n; p++) if (!allowed[p] || protect[p]) {
      assert.deepEqual(out.subarray(p*4, p*4+4), new Uint8ClampedArray(base.subarray(p*4, p*4+4)));
    }
  }
});
