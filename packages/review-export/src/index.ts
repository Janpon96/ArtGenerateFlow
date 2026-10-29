import type { Asset, GenerationJob, Id, StrictReport } from '@frs/domain';
import { labelFor, revalidateStrictFile, type PngCodec, type StrictLabel } from '@frs/image-core';

/** Where a version came from. Re-composite reuses a candidate and is not a new generation. */
export interface VersionRecord {
  assetId: Id;
  /** Job that produced the candidate. */
  jobId: Id | null;
  /** Asset this version was derived from (baseline for edits). */
  parentAssetId: Id | null;
  kind: 'import' | 'generation' | 'region_edit' | 'recomposite';
  maskRevisionId: Id | null;
  candidateAssetId: Id | null;
  strictReport: StrictReport | null;
  createdAt: string;
}

export interface VersionNode {
  record: VersionRecord;
  children: VersionNode[];
}

/** Builds a forest keyed by parentAssetId. A record whose parent is unknown becomes a root. */
export function buildVersionTree(records: readonly VersionRecord[]): VersionNode[] {
  const nodes = new Map<Id, VersionNode>();
  for (const r of records) nodes.set(r.assetId, { record: r, children: [] });
  const roots: VersionNode[] = [];
  for (const r of records) {
    const node = nodes.get(r.assetId)!;
    const parent = r.parentAssetId ? nodes.get(r.parentAssetId) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const byTime = (a: VersionNode, b: VersionNode) => a.record.createdAt.localeCompare(b.record.createdAt);
  const sort = (list: VersionNode[]) => { list.sort(byTime); list.forEach((n) => sort(n.children)); };
  sort(roots);
  return roots;
}

export interface Provenance {
  assetId: Id;
  jobId: Id | null;
  compiledPromptHash: string | null;
  orderedAssetIds: Id[];
  requestedModelLabel: string | null;
  /** What the UI really showed. null means it was never observed; never fill it from the request. */
  observedModelLabel: string | null;
  modelMismatch: boolean;
  baselineAssetId: Id | null;
  maskRevisionId: Id | null;
  reusedCandidate: boolean;
  executionMode: GenerationJob['intent']['executionMode'] | null;
}

export function provenanceFor(record: VersionRecord, job: GenerationJob | null): Provenance {
  const requested = job?.intent.requestedModelLabel ?? null;
  const observed = job?.observedModelLabel ?? null;
  return {
    assetId: record.assetId,
    jobId: record.jobId,
    compiledPromptHash: job?.intent.prompt.compiledHash ?? null,
    orderedAssetIds: job ? [...job.intent.orderedAssetIds] : [],
    requestedModelLabel: requested,
    observedModelLabel: observed,
    modelMismatch: requested !== null && observed !== null && requested !== observed,
    baselineAssetId: record.kind === 'region_edit' || record.kind === 'recomposite' ? record.parentAssetId : null,
    maskRevisionId: record.maskRevisionId,
    reusedCandidate: record.kind === 'recomposite',
    executionMode: job?.intent.executionMode ?? null,
  };
}

export type ExportFormat = 'png' | 'jpeg';
export type ExportLabel = StrictLabel | 'derived';

export interface ExportCheckInput {
  format: ExportFormat;
  /** True when the exported pixels were resized or otherwise changed after the composite. */
  resized: boolean;
  fileBytes: Uint8Array;
  report: StrictReport | null;
  base: Uint8Array;
  mask: Uint8Array;
  codec: PngCodec;
}

/**
 * Only an unmodified PNG whose bytes still match a passing report may carry the Strict label.
 * JPEG and resized files are derived. Anything unverifiable is 'not_verified'.
 */
export async function exportLabel(i: ExportCheckInput): Promise<ExportLabel> {
  if (i.format === 'jpeg' || i.resized) return 'derived';
  if (!i.report) return 'not_verified';
  const check = await revalidateStrictFile(i.fileBytes, i.report, i.base, i.mask, i.codec);
  if (!check.valid) return 'not_verified';
  return labelFor(i.report);
}

/** Metadata bundle written next to an exported image. Contains no URLs, tokens or cookies. */
export function exportManifest(asset: Asset, provenance: Provenance, label: ExportLabel, exportedAt: string) {
  return {
    schema: 'frs.export/1',
    exportedAt,
    label,
    asset: { id: asset.id, width: asset.width, height: asset.height, pixelHash: asset.normalizedPixelHash },
    provenance,
  };
}
