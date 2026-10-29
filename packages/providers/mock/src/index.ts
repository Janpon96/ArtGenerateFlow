import type {
  Asset, CapabilitySnapshot, ConnectionBinding, GenerationJob, Id, PreparedJob, ProviderAdapter,
  ReadBack, ReconcileOutcome, SubmitOutcome,
} from '@frs/domain';

/**
 * MOCK provider. It proves the orchestration, recovery and UI logic only.
 * Nothing here says anything about what Google Flow really supports:
 * every capability value carries source 'fixture' and must never be shown as a Flow fact.
 */
export const MOCK_ADAPTER_VERSION = 'mock/1.0.0 (MOCK, not Flow)';

export type MockSubmitScenario = 'accepted' | 'rejected' | 'unknown' | 'throws';

export interface MockScenario {
  submit: MockSubmitScenario;
  reconcile: ReconcileOutcome;
  /** When false the read-back reports settings that differ from the job intent. */
  readBackMatches: boolean;
  cancel: 'confirmed_cancelled' | 'unsupported' | 'unknown';
  /** Simulates a closed Flow tab: probe fails. */
  tabLost: boolean;
}

export const DEFAULT_SCENARIO: MockScenario = {
  submit: 'accepted',
  reconcile: { status: 'running', evidence: 'mock fixture' },
  readBackMatches: true,
  cancel: 'confirmed_cancelled',
  tabLost: false,
};

const NOW = () => new Date().toISOString();
const ev = <T>(value: T | null, bindingId: Id | null) => ({
  value, source: 'fixture' as const, capturedAt: NOW(), bindingId, scope: 'mock',
});

export class MockProvider implements ProviderAdapter {
  readonly label = 'MOCK';
  /** Every submit() call is recorded so tests can assert that nothing was sent twice. */
  readonly submitCalls: Array<{ jobId: Id; attemptId: Id }> = [];
  scenario: MockScenario;

  constructor(scenario: Partial<MockScenario> = {}) {
    this.scenario = { ...DEFAULT_SCENARIO, ...scenario };
  }

  async probe(binding: ConnectionBinding): Promise<CapabilitySnapshot> {
    if (this.scenario.tabLost) throw new Error('MOCK: Flow tab is no longer available.');
    const b = binding.id;
    return {
      id: `mock-snapshot-${b}`,
      bindingId: b,
      capturedAt: NOW(),
      adapterVersion: MOCK_ADAPTER_VERSION,
      uiFingerprint: 'mock',
      mode: 'standard_image',
      models: [{
        displayName: 'MOCK model',
        providerModelId: null,
        selectable: ev(true, b),
        aspectRatios: ev(['1:1', '16:9'], b),
        resolutionLabels: ev(null, b),
        outputCounts: ev([1, 2], b),
        maxReferences: ev(4, b),
        maxUploadBytes: ev(null, b),
        supportsImageEdit: ev('unknown' as const, b),
      }],
      nativeLassoVisible: ev('unknown' as const, b),
      nativeMaskImport: ev('unknown' as const, b),
      automaticUpload: ev('unsupported' as const, b),
      automaticFullResolutionCollection: ev('unsupported' as const, b),
      observedCost: ev(null, b),
    };
  }

  async prepare(job: GenerationJob): Promise<PreparedJob> {
    return {
      jobId: job.id,
      payloadHash: job.payloadHash,
      bindingId: job.bindingId,
      orderedAssetIds: [...job.intent.orderedAssetIds],
      manualSteps: [],
    };
  }

  async readBack(prepared: PreparedJob): Promise<ReadBack> {
    const ok = this.scenario.readBackMatches;
    return {
      promptHash: prepared.payloadHash,
      modelLabel: 'MOCK model',
      aspectRatio: null,
      resolutionLabel: null,
      outputCount: null,
      orderedAssetIds: ok ? prepared.orderedAssetIds : [],
      evidence: 'fixture',
      matchesIntent: ok,
      uncertainties: ok ? [] : ['MOCK: reference order differs from the job intent'],
    };
  }

  async submit(prepared: PreparedJob, attemptId: Id): Promise<SubmitOutcome> {
    this.submitCalls.push({ jobId: prepared.jobId, attemptId });
    switch (this.scenario.submit) {
      case 'accepted': return { status: 'accepted', providerJobId: `mock-${attemptId}`, evidence: 'MOCK accepted' };
      case 'rejected': return { status: 'rejected', code: 'MOCK_REJECTED', message: 'MOCK: the provider refused the request.' };
      case 'unknown': return { status: 'unknown', reason: 'MOCK: no acknowledgement observed' };
      case 'throws': throw new Error('MOCK: connection lost during submit');
    }
  }

  async reconcile(): Promise<ReconcileOutcome> {
    return this.scenario.reconcile;
  }

  async collect(job: GenerationJob): ReturnType<ProviderAdapter['collect']> {
    const asset: Asset = {
      id: `mock-asset-${job.id}`, projectId: job.intent.projectId, source: 'mock',
      originalBlobKey: 'mock', originalByteHash: '0'.repeat(64), normalizedBlobKey: 'mock',
      normalizedPixelHash: '0'.repeat(64), width: 1, height: 1, mimeType: 'image/png',
      colorSpace: 'srgb', pixelFormat: 'rgba8-straight', normalizationVersion: 'mock',
      parentAssetId: null,
    };
    return { status: 'collected', assets: [asset], provenance: 'fixture' };
  }

  async cancel(): ReturnType<ProviderAdapter['cancel']> {
    return { status: this.scenario.cancel, evidence: 'MOCK' };
  }
}
