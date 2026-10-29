/**
 * Messages between the Workbench (extension page) and the content script that runs on the
 * Flow page. Images travel as base64 because chrome messaging only carries JSON.
 * Nothing here has been verified against the real Flow UI yet.
 */
export const FLOW_ORIGIN_MATCH = 'https://flow.google.com/*';

export interface FlowImagePayload {
  name: string;
  mime: string;
  base64: string;
}

export type FlowRequest =
  | { type: 'ping' }
  | {
      type: 'fill';
      model: string | null;
      aspectRatio: string | null;
      outputCount: number;
      prompt: string;
      images: FlowImagePayload[];
    }
  | { type: 'readback' }
  | { type: 'generate' }
  | { type: 'collect'; timeoutMs: number };

export interface FlowStepLog {
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

export interface FlowReadbackData {
  modelLabel: string | null;
  aspectRatio: string | null;
  outputCount: number | null;
  imageCount: number | null;
  prompt: string | null;
}

export interface FlowCollectedImage {
  src: string;
  mime: string;
  /** null when the page blocked reading the bytes (cross-origin). */
  base64: string | null;
}

export type FlowResponse =
  | { ok: true; logs: FlowStepLog[]; readback?: FlowReadbackData; images?: FlowCollectedImage[]; pending?: boolean }
  | { ok: false; code: string; message: string; logs: FlowStepLog[] };

/** Lowercase, drop everything but letters/digits/dots. */
export function normalizeModelLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9.]+/g, '');
}

/**
 * True when two model labels name the same model. "Nano Banana 2.1" and "Nano Banana 2"
 * count as the same model family version; "Nano Banana Pro" never matches either.
 */
export function modelLabelsMatch(a: string, b: string): boolean {
  const strip = (x: string) => normalizeModelLabel(x).replace(/\.\d+$/, '');
  const na = strip(a);
  const nb = strip(b);
  return na !== '' && na === nb;
}

export function base64FromBytes(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function bytesFromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
