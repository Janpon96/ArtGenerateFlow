import { STORES, LATEST_SCHEMA_VERSION, StorageError, run, req, type StoreName } from './db';
import { BLOB_KEY_RE, SHA256_RE, sha256Bytes, type BlobRecord } from './blobs';

export const BACKUP_FORMAT = 'frs-backup';
/** Locks are runtime state and migrations belong to the target database. Neither is exported. */
const EXPORTED: StoreName[] = STORES.filter((s) => s !== 'locks' && s !== 'migrations' && s !== 'blobs');

interface BackupBlob { key: string; mimeType: string; sha256: string; base64: string }
interface BackupBody {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  createdAt: string;
  stores: Record<string, unknown[]>;
  blobs: BackupBlob[];
}
export interface BackupFile extends BackupBody { checksum: string }

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const checksumOf = (body: BackupBody) => sha256Bytes(new TextEncoder().encode(JSON.stringify(body)));

export async function exportBackup(db: IDBDatabase, now: string): Promise<BackupFile> {
  const { stores, blobs } = await run(db, [...EXPORTED, 'blobs'], 'readonly', async (tx) => {
    const stores: Record<string, unknown[]> = {};
    for (const s of EXPORTED) stores[s] = (await req(tx.objectStore(s).getAll())) as unknown[];
    const blobs = (await req(tx.objectStore('blobs').getAll())) as BlobRecord[];
    return { stores, blobs };
  });
  const body: BackupBody = {
    format: BACKUP_FORMAT,
    schemaVersion: LATEST_SCHEMA_VERSION,
    createdAt: now,
    stores,
    blobs: blobs.map((b) => ({ key: b.key, mimeType: b.mimeType, sha256: b.sha256, base64: toBase64(b.bytes) })),
  };
  return { ...body, checksum: await checksumOf(body) };
}

/** Validates everything before the first write. Throws StorageError; never partially imports. */
export async function validateBackup(raw: unknown): Promise<BackupFile> {
  const bad = (code: string, msg: string) => new StorageError(code, msg);
  if (!raw || typeof raw !== 'object') throw bad('BACKUP_FORMAT', 'Backup is not a JSON object.');
  const f = raw as Partial<BackupFile>;
  if (f.format !== BACKUP_FORMAT) throw bad('BACKUP_FORMAT', 'Not a Flow Reference Studio backup.');
  if (typeof f.schemaVersion !== 'number' || f.schemaVersion > LATEST_SCHEMA_VERSION) {
    throw bad('BACKUP_SCHEMA_TOO_NEW', 'Backup was made by a newer version of the extension.');
  }
  if (typeof f.checksum !== 'string' || !SHA256_RE.test(f.checksum)) throw bad('BACKUP_CHECKSUM', 'Backup checksum is missing or malformed.');
  if (!f.stores || typeof f.stores !== 'object' || !Array.isArray(f.blobs) || typeof f.createdAt !== 'string') {
    throw bad('BACKUP_FORMAT', 'Backup structure is incomplete.');
  }
  const { checksum, ...body } = f as BackupFile;
  if ((await checksumOf(body as BackupBody)) !== checksum) throw bad('BACKUP_CHECKSUM', 'Backup checksum does not match its content. The file is damaged or was edited.');

  for (const name of Object.keys(f.stores)) {
    if (!EXPORTED.includes(name as StoreName)) throw bad('BACKUP_UNKNOWN_STORE', `Backup contains an unknown store "${name}".`);
    if (!Array.isArray(f.stores[name])) throw bad('BACKUP_FORMAT', `Store "${name}" is not a list.`);
  }
  const seen = new Set<string>();
  for (const b of f.blobs) {
    if (!b || typeof b.key !== 'string' || !BLOB_KEY_RE.test(b.key)) throw bad('BACKUP_BLOB_KEY', 'Backup contains an invalid blob key (paths are not allowed).');
    if (seen.has(b.key)) throw bad('BACKUP_BLOB_KEY', `Blob key "${b.key}" appears twice.`);
    seen.add(b.key);
    if (typeof b.sha256 !== 'string' || !SHA256_RE.test(b.sha256)) throw bad('BACKUP_BLOB_HASH', `Blob "${b.key}" has a malformed hash.`);
    if (typeof b.base64 !== 'string') throw bad('BACKUP_FORMAT', `Blob "${b.key}" has no data.`);
    let bytes: Uint8Array;
    try { bytes = fromBase64(b.base64); } catch { throw bad('BACKUP_BLOB_HASH', `Blob "${b.key}" is not valid base64.`); }
    if ((await sha256Bytes(bytes)) !== b.sha256) throw bad('BACKUP_BLOB_HASH', `Blob "${b.key}" does not match its hash.`);
  }
  return f as BackupFile;
}

/**
 * Imports into an empty database only. Importing over existing data could silently
 * overwrite jobs, so it is refused instead.
 */
export async function importBackup(db: IDBDatabase, raw: unknown): Promise<{ records: number; blobs: number }> {
  const file = await validateBackup(raw);
  return run(db, [...EXPORTED, 'blobs'], 'readwrite', async (tx) => {
    for (const s of [...EXPORTED, 'blobs' as const]) {
      if ((await req(tx.objectStore(s).count())) > 0) throw new StorageError('BACKUP_TARGET_NOT_EMPTY', 'Import is only allowed into an empty database. Nothing was changed.');
    }
    let records = 0;
    for (const s of EXPORTED) {
      for (const rec of (file.stores[s] ?? [])) { await req(tx.objectStore(s).put(rec)); records++; }
    }
    for (const b of file.blobs) {
      await req(tx.objectStore('blobs').put({ key: b.key, mimeType: b.mimeType, sha256: b.sha256, bytes: fromBase64(b.base64) }));
    }
    return { records, blobs: file.blobs.length };
  });
}
