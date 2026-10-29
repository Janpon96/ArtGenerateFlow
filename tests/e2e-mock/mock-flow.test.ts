import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import type { GenerationJob } from '@frs/domain';
import { openFrsDb, createJob, get, listEvents } from '@frs/storage';
import { JobOrchestrator } from '@frs/job-orchestrator';
import { MockProvider } from '@frs/provider-mock';
import { runStrict, rasterize, type PngCodec } from '@frs/image-core';
import { exportLabel } from '@frs/review-export';

// All of this runs against the MOCK provider. It says nothing about Google Flow.

const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const NOW = new Date(T0).toISOString();
let n = 0;

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

function job(): GenerationJob {
  return {
    id: 'job1', parentJobId: null, revision: 1, state: 'DRAFT',
    intent: { executionMode: 'mock', maxGenerationAttempts: 1, orderedAssetIds: ['a1'], projectId: 'p1' } as unknown as GenerationJob['intent'],
    payloadHash: 'p'.repeat(64), submitAttemptId: null, manualSubmissionWindowOpenedAt: null,
    providerJobId: null, observedModelLabel: null, observedSettings: {}, bindingId: 'b1',
    eventSequence: 1, createdAt: NOW, updatedAt: NOW,
  };
}

async function setup(scenario: ConstructorParameters<typeof MockProvider>[0] = {}) {
  const db = await openFrsDb(`frs-e2e-${++n}`);
  await createJob(db, job(), NOW);
  const provider = new MockProvider(scenario);
  const orch = new JobOrchestrator(db, provider, { owner: 'tab', lockTtlMs: 60_000, nowMs: () => T0, newId: () => 'attempt-1' });
  expect(await orch.acquire()).toBe(true);
  return { db, provider, orch };
}

describe('mock end-to-end', () => {
  it('create -> collect -> region edit -> Strict export', async () => {
    const { provider, orch } = await setup({ submit: 'unknown', reconcile: { status: 'found', resultLocators: ['l'], evidence: 'MOCK' } });
    expect((await orch.start('job1')).state).toBe('NEEDS_RECONCILIATION');
    const ready = await orch.reconcile('job1');
    expect(ready.state).toBe('RESULT_READY');
    expect(provider.submitCalls).toHaveLength(1);

    const collected = await provider.collect(ready);
    expect(collected.status).toBe('collected');
    if (collected.status === 'collected') expect(collected.provenance).toBe('fixture');

    const w = 16, h = 12;
    const base = new Uint8Array(w * h * 4).map((_, i) => (i * 7) & 255);
    const candidate = new Uint8Array(w * h * 4).map((_, i) => (i * 13 + 5) & 255);
    const mask = rasterize({ kind: 'rect', x0: 4, y0: 3, x1: 12, y1: 9 }, w, h);
    const r = await runStrict({ width: w, height: h, base, candidate, mask, featherRadius: 2, codec });
    expect(r.label).toBe('strict');
    expect(await exportLabel({ format: 'png', resized: false, fileBytes: r.fileBytes, report: r.report, base, mask, codec })).toBe('strict');
    expect(await exportLabel({ format: 'jpeg', resized: false, fileBytes: r.fileBytes, report: r.report, base, mask, codec })).toBe('derived');
  });

  it('crash while SUBMITTING is reconciled and never re-submitted', async () => {
    const { db, provider, orch } = await setup({ submit: 'throws' });
    expect((await orch.start('job1')).state).toBe('NEEDS_RECONCILIATION');
    // new session: same DB, fresh orchestrator
    await orch.release();
    const next = new JobOrchestrator(db, new MockProvider(), { owner: 'tab2', lockTtlMs: 60_000, nowMs: () => T0 });
    expect(await next.acquire()).toBe(true);
    await next.recover();
    expect((await get<GenerationJob>(db, 'jobs', 'job1'))!.state).toBe('NEEDS_RECONCILIATION');
    expect(provider.submitCalls).toHaveLength(1);
    expect((await listEvents(db, 'job1')).filter((e) => e.type === 'submit.started')).toHaveLength(1);
  });

  it('cancel after submit reaches CANCELLED', async () => {
    const { orch } = await setup();
    await orch.start('job1');
    expect((await orch.cancel('job1')).state).toBe('CANCELLED');
  });
});
