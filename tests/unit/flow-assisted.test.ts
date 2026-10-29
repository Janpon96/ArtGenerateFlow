import { describe, it, expect } from 'vitest';
import type { GenerationJob, ConnectionBinding } from '@frs/domain';
import { FlowWebAssistedAdapter, manualStepsFor } from '@frs/provider-flow-web';

const job = {
  id: 'j1', bindingId: 'b1', payloadHash: 'a'.repeat(64),
  intent: {
    requestedModelLabel: 'Model X', aspectRatio: '16:9', outputCount: 2,
    orderedAssetIds: ['base', 'ref1'],
  },
} as unknown as GenerationJob;

const binding: ConnectionBinding = {
  id: 'b1', tabId: 1, frameId: 0, origin: 'https://example.invalid', projectLocator: 'p', accountContextEpoch: 1, nonce: 'n',
};

describe('Flow assisted adapter', () => {
  it('lists upload steps in the job order and ends with a manual Generate step', () => {
    const steps = manualStepsFor(job).map((s) => s.id);
    expect(steps.filter((s) => s.startsWith('upload-'))).toEqual(['upload-1', 'upload-2']);
    expect(steps[steps.length - 1]).toBe('submit');
  });

  it('never submits and never claims a capability', async () => {
    const a = new FlowWebAssistedAdapter();
    const prepared = await a.prepare(job);
    expect((await a.submit(prepared, 'x')).status).toBe('unknown');
    expect((await a.collect(job)).status).toBe('manual_import_required');
    expect((await a.cancel(job)).status).toBe('unsupported');
    const snap = await a.probe(binding);
    expect(snap.nativeMaskImport.value).toBeNull();
    expect(snap.nativeLassoVisible.value).toBeNull();
    expect(snap.models).toEqual([]);
    expect((await a.readBack(prepared)).uncertainties.length).toBeGreaterThan(0);
  });
});
