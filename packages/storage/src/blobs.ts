import { StorageError, get, put, run, req, getAll, type StoreName } from './db';

export interface BlobRecord {
  key: string;
  mimeType: string;
  bytes: Uint8Array;
  sha256: string;
}

/** Blob keys are opaque ids. Anything else (paths, separators, dots) is refused. */
export const BLOB_KEY_RE = /^[A-Za-z0-9_-]{1,128}$/;
export const SHA256_RE = /^[0-9a-f]{64}$/;

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function putBlob(db: IDBDatabase, key: string, mimeType: string, bytes: Uint8Array): Promise<BlobRecord> {
  if (!BLOB_KEY_RE.test(key)) throw new StorageError('BAD_BLOB_KEY', `Invalid blob key.`);
  const rec: BlobRecord = { key, mimeType, bytes: new Uint8Array(bytes), sha256: await sha256Bytes(bytes) };
  await put(db, 'blobs', rec);
  return rec;
}

/** Reads a blob and re-checks its stored hash. Corruption is an error, never silently served. */
export async function getBlob(db: IDBDatabase, key: string): Promise<BlobRecord | undefined> {
  const rec = await get<BlobRecord>(db, 'blobs', key);
  if (!rec) return undefined;
  if ((await sha256Bytes(rec.bytes)) !== rec.sha256) throw new StorageError('BLOB_CORRUPT', `Blob ${key} does not match its stored hash.`);
  return rec;
}

/** Stores whose records point at blobs, and the fields that hold blob keys. */
const BLOB_REFS: Array<{ store: StoreName; fields: string[] }> = [
  { store: 'assets', fields: ['originalBlobKey', 'normalizedBlobKey'] },
  { store: 'masks', fields: ['allowedMaskBlobKey', 'protectedMaskBlobKey'] },
  { store: 'results', fields: ['blobKey'] },
];

export async function reachableBlobKeys(db: IDBDatabase): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const { store, fields } of BLOB_REFS) {
    for (const rec of await getAll<Record<string, unknown>>(db, store)) {
      for (const f of fields) if (typeof rec[f] === 'string') keys.add(rec[f] as string);
    }
  }
  return keys;
}

/**
 * Deletes blobs that no asset, mask or result references. The reachability scan and the
 * deletes run in one transaction, so a blob referenced by a concurrent write is not lost.
 */
export function collectGarbage(db: IDBDatabase, opts: { dryRun?: boolean } = {}): Promise<string[]> {
  return run(db, ['blobs', ...BLOB_REFS.map((r) => r.store)], 'readwrite', async (tx) => {
    const live = new Set<string>();
    for (const { store, fields } of BLOB_REFS) {
      for (const rec of (await req(tx.objectStore(store).getAll())) as Record<string, unknown>[]) {
        for (const f of fields) if (typeof rec[f] === 'string') live.add(rec[f] as string);
      }
    }
    const blobs = tx.objectStore('blobs');
    const all = (await req(blobs.getAllKeys())) as string[];
    const dead = all.filter((k) => !live.has(k));
    if (!opts.dryRun) for (const k of dead) await req(blobs.delete(k));
    return dead;
  });
}
