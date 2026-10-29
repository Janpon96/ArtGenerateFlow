/** Design contract v1.0. Not a complete extension or a runtime validator. */
export type Id = string;
export type Sha256 = string; // runtime: exactly 64 lowercase hexadecimal chars
export type Support = 'supported' | 'unsupported' | 'unknown';
export type EvidenceSource = 'observed_ui' | 'user_confirmed' | 'official_doc' | 'fixture';
export type ProviderId = 'flow-web' | 'mock' | 'gemini-api';
export type ReferenceRole =
  | 'identity' | 'outfit' | 'pose' | 'composition' | 'environment'
  | 'style' | 'palette' | 'object' | 'detail';

export interface Evidence<T> {
  value: T | null; // null means unknown, never silently coerce to false or zero
  source: EvidenceSource;
  capturedAt: string;
  bindingId: Id | null;
  scope: string;
}

export interface Asset {
  id: Id;
  projectId: Id;
  source: 'user_upload' | 'flow_download' | 'user_import' | 'derived' | 'mock';
  originalBlobKey: Id;
  originalByteHash: Sha256;
  normalizedBlobKey: Id;
  normalizedPixelHash: Sha256;
  width: number;
  height: number;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  colorSpace: 'srgb';
  pixelFormat: 'rgba8-straight';
  normalizationVersion: string;
  parentAssetId: Id | null;
}

export interface TraitConstraint {
  subjectKey: string;
  attribute: string;
  value: string;
  operation: 'preserve' | 'change_to' | 'avoid';
  sourceRefId: Id | null;
}

export interface ReferenceBinding {
  id: Id;
  assetId: Id;
  alias: string;
  roles: ReferenceRole[];
  subjectKey: string | null;
  priority: 'primary' | 'secondary' | 'supporting';
  includeTraits: string[];
  excludeTraits: string[];
  active: boolean;
}

export interface PromptDocument {
  rawBrief: string;
  artStyle: string;
  language: 'vi' | 'en' | 'other';
  exactText: string[];
  constraints: TraitConstraint[];
  compiledText: string;
  compilerVersion: string;
  compiledHash: Sha256;
  sourceMap: Array<{
    inputIndex: number; // 1-based actual upload order, includes base if present
    assetId: Id;
    byteHash: Sha256;
    referenceId: Id | null;
    purpose: 'base' | 'reference' | 'guide';
  }>;
  warnings: Array<{ code: string; severity: 'info' | 'warning' | 'blocking'; message: string }>;
}

export interface ConnectionBinding {
  id: Id;
  tabId: number;
  frameId: 0;
  origin: string;
  projectLocator: string;
  accountContextEpoch: number;
  nonce: string;
}

export interface ModelCapability {
  displayName: string;
  providerModelId: string | null; // do not infer API ID from UI label
  selectable: Evidence<boolean>;
  aspectRatios: Evidence<string[]>;
  resolutionLabels: Evidence<string[]>;
  outputCounts: Evidence<number[]>;
  maxReferences: Evidence<number>;
  maxUploadBytes: Evidence<number>;
  supportsImageEdit: Evidence<Support>;
}

export interface CapabilitySnapshot {
  id: Id;
  bindingId: Id;
  capturedAt: string;
  adapterVersion: string;
  uiFingerprint: string;
  mode: 'standard_image' | 'agent_auto';
  models: ModelCapability[];
  nativeLassoVisible: Evidence<Support>;
  nativeMaskImport: Evidence<Support>;
  automaticUpload: Evidence<Support>;
  automaticFullResolutionCollection: Evidence<Support>;
  observedCost: Evidence<{ unit: string; amountPerOutput: number }>;
}

export interface Rect { x: number; y: number; width: number; height: number }
export interface CropMapping {
  baseRect: Rect;
  uploadedWidth: number;
  uploadedHeight: number;
  padding: { left: number; top: number; right: number; bottom: number };
  scaleX: number;
  scaleY: number;
  candidateToBaseTransform: number[] | null; // explicit 3x3 matrix if aligned by user
}

export interface MaskRevision {
  id: Id;
  baseAssetId: Id;
  basePixelHash: Sha256;
  width: number;
  height: number;
  allowedMaskBlobKey: Id;
  protectedMaskBlobKey: Id;
  effectiveMaskHash: Sha256;
  featherRadiusPx: number;
  featherMode: 'inward_only';
  cropMapping: CropMapping | null;
}

export type JobState =
  | 'DRAFT' | 'VALIDATING' | 'READY' | 'BLOCKED' | 'PREPARING'
  | 'AWAITING_USER' | 'SUBMITTING' | 'OBSERVING' | 'NEEDS_RECONCILIATION'
  | 'RESULT_READY' | 'VERIFYING' | 'REVIEW' | 'COMPLETED' | 'PAUSED'
  | 'FAILED' | 'CANCEL_REQUESTED' | 'CANCELLED' | 'ABANDONED';

export interface GenerationIntent {
  projectId: Id;
  operation: 'generate' | 'variation' | 'region_edit';
  provider: ProviderId;
  executionMode: 'assisted' | 'dom_verified' | 'api' | 'mock';
  providerMode: 'standard_image' | 'agent_auto';
  requestedModelLabel: string | null; // null only for explicit Agent Auto
  prompt: PromptDocument;
  referenceBindings: ReferenceBinding[];
  orderedAssetIds: Id[];
  aspectRatio: string | null;
  providerResolutionLabel: string | null;
  outputCount: number;
  baseAssetId: Id | null;
  maskRevisionId: Id | null;
  editStrategy: 'native_flow' | 'context_crop' | 'full_frame' | null;
  capabilitySnapshotId: Id;
  maxGenerationAttempts: number; // authorization ceiling, not automatic retry policy
}

export interface GenerationJob {
  id: Id;
  parentJobId: Id | null;
  revision: number;
  state: JobState;
  intent: Readonly<GenerationIntent>;
  payloadHash: Sha256;
  submitAttemptId: Id | null;
  manualSubmissionWindowOpenedAt: string | null;
  providerJobId: string | null;
  observedModelLabel: string | null;
  observedSettings: Record<string, string | number | null>;
  bindingId: Id;
  eventSequence: number;
  createdAt: string;
  updatedAt: string;
}

export interface PreparedJob {
  jobId: Id;
  payloadHash: Sha256;
  bindingId: Id;
  orderedAssetIds: Id[];
  manualSteps: Array<{ id: string; description: string; completed: boolean }>;
}

export interface ReadBack {
  promptHash: Sha256 | null;
  modelLabel: string | null;
  aspectRatio: string | null;
  resolutionLabel: string | null;
  outputCount: number | null;
  orderedAssetIds: Id[] | null;
  evidence: EvidenceSource;
  matchesIntent: boolean;
  uncertainties: string[];
}

export type SubmitOutcome =
  | { status: 'accepted'; providerJobId: string | null; evidence: string }
  | { status: 'rejected'; code: string; message: string }
  | { status: 'unknown'; reason: string };

export type ReconcileOutcome =
  | { status: 'running'; evidence: string }
  | { status: 'found'; resultLocators: string[]; evidence: string }
  | { status: 'definitely_absent'; evidence: string }
  | { status: 'ambiguous'; reason: string };

export interface ProviderAdapter {
  probe(binding: ConnectionBinding): Promise<CapabilitySnapshot>;
  prepare(job: GenerationJob): Promise<PreparedJob>;
  readBack(prepared: PreparedJob): Promise<ReadBack>;
  submit(prepared: PreparedJob, attemptId: Id): Promise<SubmitOutcome>;
  reconcile(job: GenerationJob): Promise<ReconcileOutcome>;
  collect(job: GenerationJob, userSelection?: string): Promise<
    { status: 'collected'; assets: Asset[]; provenance: EvidenceSource }
    | { status: 'manual_import_required'; reason: string }
  >;
  cancel(job: GenerationJob): Promise<
    { status: 'confirmed_cancelled' | 'unsupported' | 'unknown'; evidence: string }
  >;
}

export interface StrictReport {
  width: number;
  height: number;
  outsidePixelCount: number;
  outsideChangedPixels: number;
  maxOutsideChannelDelta: number;
  basePixelHash: Sha256;
  maskHash: Sha256;
  candidatePixelHash: Sha256;
  outputPixelHash: Sha256;
  outputFileHash: Sha256;
  normalizationVersion: string;
  decoderVersion: string;
  encoderVersion: string;
  verifiedAt: string;
  format: 'png';
  unchangedGeometry: true;
  passed: boolean;
}

export interface CommandEnvelope<T> {
  protocolVersion: 1;
  commandId: Id;
  bindingId: Id;
  bindingNonce: string;
  jobId: Id | null;
  type: string;
  payload: T; // must pass runtime schema and contain only JSON-serializable data
}
