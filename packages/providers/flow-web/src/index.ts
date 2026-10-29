import type {
  CapabilitySnapshot, ConnectionBinding, GenerationJob, Id, PreparedJob, ProviderAdapter,
  ReadBack, ReconcileOutcome, SubmitOutcome,
} from '@frs/domain';

/**
 * Flow web adapter, ASSISTED mode only.
 *
 * What this adapter does NOT do, on purpose:
 *  - it does not touch the Flow page (no selectors, no DOM reads or writes);
 *  - it does not call any Flow endpoint and does not read cookies, tokens or profiles;
 *  - it never presses Generate. The user does.
 * G0 (live observation of Flow) has not been run, so every capability is unknown until
 * the user confirms it. See docs/COMPATIBILITY_LEDGER.json.
 */
export const FLOW_ASSISTED_ADAPTER_VERSION = 'flow-web-assisted/1.0.0 (no DOM automation)';

const UNVERIFIED_SCOPE = 'unverified: live Flow observation (G0) has not been run';

const unknown = <T>(bindingId: Id | null) => ({
  value: null as T | null,
  source: 'user_confirmed' as const, // a null value means "not confirmed yet"
  capturedAt: new Date().toISOString(),
  bindingId,
  scope: UNVERIFIED_SCOPE,
});

export interface AssistedStep {
  id: string;
  description: string;
}

/** Ordered manual steps for one job. Pure function of the job so the UI and tests can reuse it. */
export function manualStepsFor(job: GenerationJob): AssistedStep[] {
  const i = job.intent;
  const steps: AssistedStep[] = [];
  if (i.requestedModelLabel) {
    steps.push({ id: 'model', description: `In Flow, choose the model labelled "${i.requestedModelLabel}".` });
  } else {
    steps.push({ id: 'model', description: 'In Flow, use Agent Auto only if you chose it on purpose.' });
  }
  if (i.aspectRatio) steps.push({ id: 'ratio', description: `Set the aspect ratio to ${i.aspectRatio}.` });
  steps.push({ id: 'count', description: `Set the number of outputs to ${i.outputCount}.` });
  i.orderedAssetIds.forEach((assetId, idx) => {
    steps.push({ id: `upload-${idx + 1}`, description: `Upload image ${idx + 1} of ${i.orderedAssetIds.length} (asset ${assetId}), keeping this order.` });
  });
  steps.push({ id: 'prompt', description: 'Paste the compiled prompt from the panel into the Flow prompt box.' });
  steps.push({ id: 'submit', description: 'Check the settings, then press Generate in Flow yourself. Come back and confirm here.' });
  return steps;
}

export class FlowWebAssistedAdapter implements ProviderAdapter {
  /** Nothing observed, so the snapshot only says "unknown" for every capability. */
  async probe(binding: ConnectionBinding): Promise<CapabilitySnapshot> {
    const b = binding.id;
    return {
      id: `flow-assisted-${b}`,
      bindingId: b,
      capturedAt: new Date().toISOString(),
      adapterVersion: FLOW_ASSISTED_ADAPTER_VERSION,
      uiFingerprint: 'not-observed',
      mode: 'standard_image',
      models: [],
      nativeLassoVisible: unknown(b),
      nativeMaskImport: unknown(b),
      automaticUpload: { ...unknown(b), source: 'official_doc', scope: 'assisted mode: the user uploads' },
      automaticFullResolutionCollection: { ...unknown(b), source: 'official_doc', scope: 'assisted mode: the user imports results' },
      observedCost: unknown(b),
    };
  }

  async prepare(job: GenerationJob): Promise<PreparedJob> {
    return {
      jobId: job.id,
      payloadHash: job.payloadHash,
      bindingId: job.bindingId,
      orderedAssetIds: [...job.intent.orderedAssetIds],
      manualSteps: manualStepsFor(job).map((s) => ({ ...s, completed: false })),
    };
  }

  /**
   * The adapter cannot see the Flow page, so nothing is verified here.
   * matchesIntent=true only means "nothing contradicts the intent"; `uncertainties`
   * lists what the user must check by hand.
   */
  async readBack(prepared: PreparedJob): Promise<ReadBack> {
    return {
      promptHash: prepared.payloadHash,
      modelLabel: null,
      aspectRatio: null,
      resolutionLabel: null,
      outputCount: null,
      orderedAssetIds: null,
      evidence: 'user_confirmed',
      matchesIntent: true,
      uncertainties: [
        'Model, ratio, output count and reference order in Flow were not observed.',
        'Confirm each manual step before pressing Generate.',
      ],
    };
  }

  /** Assisted mode never submits. Returning unknown keeps any caller on the reconcile path. */
  async submit(_prepared: PreparedJob, _attemptId: Id): Promise<SubmitOutcome> {
    return { status: 'unknown', reason: 'Assisted mode: the user presses Generate in Flow. The extension does not submit.' };
  }

  async reconcile(_job: GenerationJob): Promise<ReconcileOutcome> {
    return { status: 'ambiguous', reason: 'Flow was not observed. Ask the user whether the generation started, finished or never ran.' };
  }

  async collect(_job: GenerationJob): ReturnType<ProviderAdapter['collect']> {
    return { status: 'manual_import_required', reason: 'Download the result from Flow yourself and import the file into the Workbench.' };
  }

  async cancel(_job: GenerationJob): ReturnType<ProviderAdapter['cancel']> {
    return { status: 'unsupported', evidence: 'Assisted mode cannot cancel a Flow generation. Cancel it in Flow.' };
  }
}

export * from './protocol';
export * from './dom-adapter';
