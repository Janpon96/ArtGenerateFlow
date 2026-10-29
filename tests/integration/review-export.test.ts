import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import type { GenerationJob } from '@frs/domain';
import { runStrict, rasterize, type PngCodec } from '@frs/image-core';
import {
  buildVersionTree, provenanceFor, exportLabel, type VersionRecord,
} from '@frs/review-export';

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

const w = 16, h = 12;

async function strictFixture() {
  const base = pixels(w * h, 5);
  const candidate = pixels(w * h, 77);
  const mask = rasterize({ kind: 'rect', x0: 4, y0: 3, x1: 12, y1: 9 }, w, h);
  const r = await runStrict({ width: w, height: h, base, candidate, mask, codec });
  return { base, mask, r };
}

function rec(assetId: string, parentAssetId: string | null, createdAt: string, kind: VersionRecord['kind'] = 'generation'): VersionRecord {
  return { assetId, jobId: null, parentAssetId, kind, maskRevisionId: null, candidateAssetId: null, strictReport: null, createdAt };
}

describe('version tree', () => {
  it('nests children under their parent, orders by time and roots orphans', () => {
    const tree = buildVersionTree([
      rec('c2', 'a', '2026-01-01T00:00:03Z'),
      rec('a', null, '2026-01-01T00:00:01Z'),
      rec('c1', 'a', '2026-01-01T00:00:02Z'),
      rec('orphan', 'missing', '2026-01-01T00:00:00Z'),
    ]);
    expect(tree.map((n) => n.record.assetId)).toEqual(['orphan', 'a']);
    expect(tree[1]!.children.map((n) => n.record.assetId)).toEqual(['c1', 'c2']);
  });

  it('does not loop when a record names itself as parent', () => {
    const tree = buildVersionTree([rec('x', 'x', '2026-01-01T00:00:00Z')]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.children).toHaveLength(0);
  });
});

describe('provenance', () => {
  const job = {
    observedModelLabel: null,
    intent: {
      requestedModelLabel: 'Model A',
      executionMode: 'assisted',
      orderedAssetIds: ['r1', 'r2'],
      prompt: { compiledHash: 'abc' },
    },
  } as unknown as GenerationJob;

  it('never fills the observed model from the request', () => {
    const p = provenanceFor(rec('a', null, 't'), job);
    expect(p.requestedModelLabel).toBe('Model A');
    expect(p.observedModelLabel).toBeNull();
    expect(p.modelMismatch).toBe(false);
    expect(p.orderedAssetIds).toEqual(['r1', 'r2']);
    expect(p.compiledPromptHash).toBe('abc');
  });

  it('flags a model mismatch only when both labels are known', () => {
    const seen = { ...job, observedModelLabel: 'Model B' } as GenerationJob;
    expect(provenanceFor(rec('a', null, 't'), seen).modelMismatch).toBe(true);
  });

  it('marks a recomposite as reused, with the baseline kept', () => {
    const p = provenanceFor(rec('v2', 'base', 't', 'recomposite'), job);
    expect(p.reusedCandidate).toBe(true);
    expect(p.baselineAssetId).toBe('base');
  });
});

describe('export label', () => {
  it('gives the Strict label to an intact PNG with a passing report', async () => {
    const { base, mask, r } = await strictFixture();
    const label = await exportLabel({ format: 'png', resized: false, fileBytes: r.fileBytes, report: r.report, base, mask, codec });
    expect(label).toBe('strict');
  });

  it('labels JPEG and resized exports as derived even with a passing report', async () => {
    const { base, mask, r } = await strictFixture();
    const common = { fileBytes: r.fileBytes, report: r.report, base, mask, codec };
    expect(await exportLabel({ ...common, format: 'jpeg', resized: false })).toBe('derived');
    expect(await exportLabel({ ...common, format: 'png', resized: true })).toBe('derived');
  });

  it('drops the Strict label when the file bytes changed after verification', async () => {
    const { base, mask, r } = await strictFixture();
    const tampered = new Uint8Array(r.fileBytes);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1]! ^ 0xff) & 0xff;
    const label = await exportLabel({ format: 'png', resized: false, fileBytes: tampered, report: r.report, base, mask, codec });
    expect(label).toBe('not_verified');
  });

  it('is not_verified without a report', async () => {
    const { base, mask, r } = await strictFixture();
    const label = await exportLabel({ format: 'png', resized: false, fileBytes: r.fileBytes, report: null, base, mask, codec });
    expect(label).toBe('not_verified');
  });
});
