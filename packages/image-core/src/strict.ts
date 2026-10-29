import type { StrictReport } from '@frs/domain';
import { compositeRegion, featherInward, verifyOutside } from './mask-core';
import { pixelHash } from './import';
import { maskHash, sha256Bytes } from './hash';

/** PNG codec is injected: pngjs in tests, a browser codec in the extension. */
export interface PngCodec {
  encoderVersion: string;
  decoderVersion: string;
  encode(width: number, height: number, rgba: Uint8ClampedArray): Promise<Uint8Array>;
  decode(bytes: Uint8Array): Promise<{ width: number; height: number; rgba: Uint8Array }>;
}

export const NORMALIZATION_VERSION = 'srgb-rgba8-exif-once/1';

export type StrictLabel = 'strict' | 'edit_whole_image' | 'not_verified';

export interface StrictResult {
  fileBytes: Uint8Array;
  report: StrictReport;
  label: StrictLabel;
}

export interface StrictInput {
  width: number;
  height: number;
  /** Canonical baseline, straight RGBA8. */
  base: Uint8Array | Uint8ClampedArray;
  /** Candidate already mapped to baseline geometry. */
  candidate: Uint8Array | Uint8ClampedArray;
  /** Effective mask A = U and not P. */
  mask: Uint8Array;
  featherRadius?: number;
  codec: PngCodec;
  now?: () => string;
}

/** Composite, encode to PNG, decode the same saved bytes, then verify outside the mask. */
export async function runStrict(input: StrictInput): Promise<StrictResult> {
  const { width, height, base, candidate, mask, codec } = input;
  const weights = featherInward(mask, width, height, input.featherRadius ?? 0);
  const composite = compositeRegion(base, candidate, mask, weights, width, height);
  const fileBytes = await codec.encode(width, height, composite);
  const decoded = await codec.decode(fileBytes);
  const geometryOk = decoded.width === width && decoded.height === height;
  const rgba = geometryOk ? decoded.rgba : new Uint8Array(width * height * 4);
  const outside = verifyOutside(base, rgba, mask, width, height);
  const report: StrictReport = {
    width, height,
    outsidePixelCount: outside.outsidePixelCount,
    outsideChangedPixels: geometryOk ? outside.outsideChangedPixels : outside.outsidePixelCount,
    maxOutsideChannelDelta: outside.maxOutsideChannelDelta,
    basePixelHash: await pixelHash(width, height, base as Uint8Array),
    maskHash: await maskHash(width, height, mask),
    candidatePixelHash: await pixelHash(width, height, candidate as Uint8Array),
    outputPixelHash: await pixelHash(decoded.width, decoded.height, decoded.rgba),
    outputFileHash: await sha256Bytes(fileBytes),
    normalizationVersion: NORMALIZATION_VERSION,
    decoderVersion: codec.decoderVersion,
    encoderVersion: codec.encoderVersion,
    verifiedAt: (input.now ?? (() => new Date().toISOString()))(),
    format: 'png',
    unchangedGeometry: true,
    passed: geometryOk && outside.preserved,
  };
  return { fileBytes, report, label: labelFor(report) };
}

/**
 * A full-image mask has no outside region, so nothing was verified: it is labelled
 * "edit whole image", never Strict.
 */
export function labelFor(report: StrictReport): StrictLabel {
  if (!report.passed) return 'not_verified';
  return report.outsidePixelCount === 0 ? 'edit_whole_image' : 'strict';
}

/** Re-checks a saved file against its report. Any change to the file bytes invalidates the report. */
export async function revalidateStrictFile(
  fileBytes: Uint8Array, report: StrictReport,
  base: Uint8Array | Uint8ClampedArray, mask: Uint8Array, codec: PngCodec,
): Promise<{ valid: boolean; reason?: 'FILE_CHANGED' | 'GEOMETRY' | 'OUTSIDE_CHANGED' | 'BASE_CHANGED' | 'MASK_CHANGED' }> {
  if ((await sha256Bytes(fileBytes)) !== report.outputFileHash) return { valid: false, reason: 'FILE_CHANGED' };
  if ((await pixelHash(report.width, report.height, base as Uint8Array)) !== report.basePixelHash) return { valid: false, reason: 'BASE_CHANGED' };
  if ((await maskHash(report.width, report.height, mask)) !== report.maskHash) return { valid: false, reason: 'MASK_CHANGED' };
  const decoded = await codec.decode(fileBytes);
  if (decoded.width !== report.width || decoded.height !== report.height) return { valid: false, reason: 'GEOMETRY' };
  const outside = verifyOutside(base, decoded.rgba, mask, report.width, report.height);
  return outside.preserved ? { valid: true } : { valid: false, reason: 'OUTSIDE_CHANGED' };
}

/** PNG-02: sources the MVP cannot normalise exactly are blocked from Strict. */
export interface SourceColorInfo { bitDepth: number; hasIccProfile: boolean; iccIsSrgb: boolean; hdr: boolean }

export function strictBlockers(info: SourceColorInfo): string[] {
  const out: string[] = [];
  if (info.bitDepth > 8) out.push('SOURCE_HIGH_BIT_DEPTH');
  if (info.hdr) out.push('SOURCE_HDR');
  if (info.hasIccProfile && !info.iccIsSrgb) out.push('SOURCE_WIDE_GAMUT');
  return out;
}
