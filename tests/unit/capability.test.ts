import { describe, it, expect } from 'vitest';
import {
  availableEditStrategies, revalidateBeforeSubmit, staleReasons, validateAgainstSnapshot, CAPABILITY_TTL_MS,
  type CapabilitySnapshot, type Evidence, type ModelCapability, type Support,
} from '@frs/domain';

const ev = <T>(value: T | null): Evidence<T> => ({ value, source: 'fixture', capturedAt: '2026-01-01T00:00:00.000Z', bindingId: 'b1', scope: 'test' });

/** Unknown evidence: value is null, with the type given explicitly so it is not inferred as `null`. */
const unk = <T>(): Evidence<T> => ev<T>(null);

const model = (over: Partial<ModelCapability> = {}): ModelCapability => ({
  displayName: 'Model A', providerModelId: null, selectable: ev(true), aspectRatios: ev(['1:1', '16:9']),
  resolutionLabels: unk<string[]>(), outputCounts: ev([1, 2]), maxReferences: unk<number>(), maxUploadBytes: unk<number>(),
  supportsImageEdit: ev<Support>('supported'), ...over,
});

const snap = (over: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot => ({
  id: 's1', bindingId: 'b1', capturedAt: '2026-01-01T00:00:00.000Z', adapterVersion: 'a1', uiFingerprint: 'u1',
  mode: 'standard_image', models: [model()], nativeLassoVisible: ev<Support>('unknown'),
  nativeMaskImport: ev<Support>('unknown'), automaticUpload: ev<Support>('unknown'),
  automaticFullResolutionCollection: ev<Support>('unknown'), observedCost: unk<{ unit: string; amountPerOutput: number }>(), ...over,
});

const intent = (over = {}) => ({
  providerMode: 'standard_image' as const, requestedModelLabel: 'Model A' as string | null, aspectRatio: '16:9' as string | null,
  outputCount: 1, operation: 'generate' as const, editStrategy: null, referenceCount: 4, ...over,
});

const ctx = { bindingId: 'b1', adapterVersion: 'a1', uiFingerprint: 'u1', nowMs: Date.parse('2026-01-01T00:05:00.000Z') };

describe('capability registry (CAP-01)', () => {
  it('never selects a model that is not offered and does not fall back to another', () => {
    const r = validateAgainstSnapshot(snap({ models: [model({ displayName: 'Other' })] }), intent());
    expect(r.status).toBe('blocked');
    expect(r.issues.map((i) => i.code)).toEqual(['MODEL_NOT_FOUND']);
    expect(r.model).toBeNull();
  });

  it('treats unknown values as manual confirmation, not as supported or unsupported (CAP-03)', () => {
    const r = validateAgainstSnapshot(snap({ models: [model({ aspectRatios: unk<string[]>(), outputCounts: unk<number[]>() })] }), intent());
    expect(r.status).toBe('needs_manual');
    expect(r.issues.map((i) => i.code).sort()).toEqual(['ASPECT_UNKNOWN', 'MAX_REFS_UNKNOWN', 'OUTPUT_COUNT_UNKNOWN']);
  });

  it('blocks when a known limit is exceeded and does not drop references', () => {
    const r = validateAgainstSnapshot(snap({ models: [model({ maxReferences: ev(3) })] }), intent({ referenceCount: 4 }));
    expect(r.issues.find((i) => i.code === 'MAX_REFS_EXCEEDED')?.severity).toBe('blocking');
  });

  it('requires an explicit Agent Auto choice instead of a null model', () => {
    expect(validateAgainstSnapshot(snap(), intent({ requestedModelLabel: null })).issues[0]?.code).toBe('MODEL_REQUIRED');
    const auto = validateAgainstSnapshot(snap({ mode: 'agent_auto' }), intent({ providerMode: 'agent_auto', requestedModelLabel: null }));
    expect(auto.status).toBe('ok');
  });

  it('blocks when Flow is in a different mode than the job (CAP-02)', () => {
    const r = validateAgainstSnapshot(snap({ mode: 'agent_auto' }), intent());
    expect(r.issues.some((i) => i.code === 'MODE_MISMATCH' && i.severity === 'blocking')).toBe(true);
  });

  it('expires after 10 minutes and on binding, adapter or UI change', () => {
    expect(staleReasons(snap(), ctx)).toEqual([]);
    expect(staleReasons(snap(), { ...ctx, nowMs: ctx.nowMs + CAPABILITY_TTL_MS })).toEqual(['expired']);
    expect(staleReasons(snap(), { ...ctx, bindingId: 'b2', adapterVersion: 'a2', uiFingerprint: 'u2' }))
      .toEqual(['binding_changed', 'adapter_changed', 'ui_changed']);
    expect(validateAgainstSnapshot(snap(), intent(), { ...ctx, uiFingerprint: 'u2' }).status).toBe('blocked');
  });

  it('blocks submit when the prepared model vanished', () => {
    const issues = revalidateBeforeSubmit(snap(), snap({ models: [] }), 'Model A');
    expect(issues.map((i) => i.code)).toEqual(['MODEL_VANISHED']);
    expect(revalidateBeforeSubmit(snap(), snap(), 'Model A')).toEqual([]);
  });

  it('offers native selection only when the lasso is confirmed, and keeps mask import separate', () => {
    expect(availableEditStrategies(snap()).strategies).toEqual(['context_crop', 'full_frame']);
    const withLasso = availableEditStrategies(snap({ nativeLassoVisible: ev<Support>('supported') }));
    expect(withLasso.strategies[0]).toBe('native_flow');
    expect(withLasso.nativeMaskImport).toBe('unknown');
    expect(validateAgainstSnapshot(snap(), intent({ editStrategy: 'native_flow', operation: 'region_edit' })).issues
      .some((i) => i.code === 'NATIVE_LASSO_NOT_SUPPORTED')).toBe(true);
  });
});
