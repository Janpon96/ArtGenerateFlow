import type { CapabilitySnapshot, Evidence, GenerationIntent, ModelCapability, Support } from './types';

/** Proposed by docs/03, not a fact about Flow. */
export const CAPABILITY_TTL_MS = 10 * 60 * 1000;

export type IssueCode =
  | 'SNAPSHOT_STALE' | 'MODE_MISMATCH' | 'MODEL_REQUIRED' | 'MODEL_NOT_FOUND' | 'MODEL_NOT_SELECTABLE'
  | 'MODEL_SELECTABLE_UNKNOWN' | 'ASPECT_UNSUPPORTED' | 'ASPECT_UNKNOWN' | 'OUTPUT_COUNT_UNSUPPORTED'
  | 'OUTPUT_COUNT_UNKNOWN' | 'MAX_REFS_EXCEEDED' | 'MAX_REFS_UNKNOWN' | 'EDIT_UNSUPPORTED'
  | 'EDIT_UNKNOWN' | 'NATIVE_LASSO_NOT_SUPPORTED' | 'MODEL_VANISHED';

export interface CapabilityIssue {
  code: IssueCode;
  /** blocking: do not submit. manual: the user must confirm the value in Flow; we never assume it. */
  severity: 'blocking' | 'manual';
  message: string;
}

export interface ValidationResult {
  /** 'ok' only when nothing is blocking and nothing needs manual confirmation. */
  status: 'ok' | 'needs_manual' | 'blocked';
  issues: CapabilityIssue[];
  model: ModelCapability | null;
}

export interface SnapshotContext {
  bindingId: string;
  adapterVersion: string;
  uiFingerprint: string;
  nowMs: number;
}

/** null means unknown. It is never coerced to false or zero. */
export const supportOf = (e: Evidence<Support>): Support => e.value ?? 'unknown';

/**
 * A snapshot may be reused only for the same tab binding, adapter and UI fingerprint,
 * and only for 10 minutes. Returns the reasons it cannot be reused (empty = usable).
 */
export function staleReasons(s: CapabilitySnapshot, ctx: SnapshotContext, ttlMs = CAPABILITY_TTL_MS): string[] {
  const reasons: string[] = [];
  const age = ctx.nowMs - Date.parse(s.capturedAt);
  if (!Number.isFinite(age) || age < 0 || age > ttlMs) reasons.push('expired');
  if (s.bindingId !== ctx.bindingId) reasons.push('binding_changed');
  if (s.adapterVersion !== ctx.adapterVersion) reasons.push('adapter_changed');
  if (s.uiFingerprint !== ctx.uiFingerprint) reasons.push('ui_changed');
  return reasons;
}

export function findModel(s: CapabilitySnapshot, label: string): ModelCapability | null {
  return s.models.find((m) => m.displayName === label) ?? null;
}

type IntentForCaps = Pick<
  GenerationIntent,
  'providerMode' | 'requestedModelLabel' | 'aspectRatio' | 'outputCount' | 'operation' | 'editStrategy'
> & { referenceCount: number };

/**
 * Checks an intent against a snapshot. It never picks a different model and never treats
 * an unknown value as supported: unknown becomes a manual-confirmation item.
 */
export function validateAgainstSnapshot(
  s: CapabilitySnapshot,
  intent: IntentForCaps,
  ctx?: SnapshotContext,
): ValidationResult {
  const issues: CapabilityIssue[] = [];
  const add = (code: IssueCode, severity: CapabilityIssue['severity'], message: string) =>
    issues.push({ code, severity, message });

  if (ctx) {
    const stale = staleReasons(s, ctx);
    if (stale.length) add('SNAPSHOT_STALE', 'blocking', `Capabilities must be read again (${stale.join(', ')}).`);
  }
  if (s.mode !== intent.providerMode) {
    add('MODE_MISMATCH', 'blocking', `Flow is in ${s.mode} mode but the job needs ${intent.providerMode}. Switch it in Flow, then read again.`);
  }

  let model: ModelCapability | null = null;
  if (intent.providerMode === 'agent_auto') {
    // Agent Auto has no model choice. Model limits stay unknown, so nothing below is checked against a model.
  } else if (intent.requestedModelLabel === null) {
    add('MODEL_REQUIRED', 'blocking', 'Choose a model, or choose Agent Auto explicitly.');
  } else {
    model = findModel(s, intent.requestedModelLabel);
    if (!model) {
      add('MODEL_NOT_FOUND', 'blocking', `Model "${intent.requestedModelLabel}" is not offered now. The job stays as a draft; no other model was selected.`);
    } else if (model.selectable.value === false) {
      add('MODEL_NOT_SELECTABLE', 'blocking', `Model "${model.displayName}" is shown but cannot be selected now.`);
    } else if (model.selectable.value === null) {
      add('MODEL_SELECTABLE_UNKNOWN', 'manual', `Could not tell whether "${model.displayName}" is selectable. Confirm it in Flow.`);
    }
  }

  if (model) {
    if (intent.aspectRatio !== null) {
      const list = model.aspectRatios.value;
      if (list === null) add('ASPECT_UNKNOWN', 'manual', 'Supported aspect ratios are unknown. Confirm the ratio in Flow.');
      else if (!list.includes(intent.aspectRatio)) add('ASPECT_UNSUPPORTED', 'blocking', `Ratio ${intent.aspectRatio} is not offered for "${model.displayName}".`);
    }
    const counts = model.outputCounts.value;
    if (counts === null) add('OUTPUT_COUNT_UNKNOWN', 'manual', 'Supported output counts are unknown. Confirm the count in Flow.');
    else if (!counts.includes(intent.outputCount)) add('OUTPUT_COUNT_UNSUPPORTED', 'blocking', `${intent.outputCount} outputs is not offered for "${model.displayName}".`);

    const max = model.maxReferences.value;
    if (max === null) add('MAX_REFS_UNKNOWN', 'manual', 'The reference limit is unknown. Check that Flow accepted every upload.');
    else if (intent.referenceCount > max) add('MAX_REFS_EXCEEDED', 'blocking', `"${model.displayName}" accepts ${max} references; this job has ${intent.referenceCount}. Nothing was dropped.`);

    if (intent.operation === 'region_edit') {
      const edit = supportOf(model.supportsImageEdit);
      if (edit === 'unsupported') add('EDIT_UNSUPPORTED', 'blocking', `"${model.displayName}" does not support image edit.`);
      else if (edit === 'unknown') add('EDIT_UNKNOWN', 'manual', 'Image edit support is unknown. Confirm it in Flow.');
    }
  }

  if (intent.editStrategy === 'native_flow' && supportOf(s.nativeLassoVisible) !== 'supported') {
    add('NATIVE_LASSO_NOT_SUPPORTED', 'blocking', 'Flow selection tool is not confirmed. Use context crop or full frame.');
  }

  const status = issues.some((i) => i.severity === 'blocking') ? 'blocked' : issues.length ? 'needs_manual' : 'ok';
  return { status, issues, model };
}

/**
 * Re-check right before submit. If the model that was prepared is gone, block and keep the draft.
 * There is no fallback to another model.
 */
export function revalidateBeforeSubmit(prepared: CapabilitySnapshot, current: CapabilitySnapshot, modelLabel: string | null): CapabilityIssue[] {
  if (modelLabel === null) return [];
  const before = findModel(prepared, modelLabel);
  const now = findModel(current, modelLabel);
  if (before && !now) {
    return [{ code: 'MODEL_VANISHED', severity: 'blocking', message: `Model "${modelLabel}" disappeared between prepare and submit. Nothing was submitted and no other model was chosen.` }];
  }
  return [];
}

/**
 * Edit strategies the UI may offer. Context crop and full frame need nothing from Flow.
 * Native selection needs a visible lasso. Native mask import is separate and is never assumed:
 * even with a native selection, the local mask still decides the final composite.
 */
export function availableEditStrategies(s: CapabilitySnapshot): {
  strategies: Array<'native_flow' | 'context_crop' | 'full_frame'>;
  nativeLasso: Support;
  nativeMaskImport: Support;
} {
  const nativeLasso = supportOf(s.nativeLassoVisible);
  return {
    strategies: [...(nativeLasso === 'supported' ? (['native_flow'] as const) : []), 'context_crop', 'full_frame'],
    nativeLasso,
    nativeMaskImport: supportOf(s.nativeMaskImport),
  };
}
