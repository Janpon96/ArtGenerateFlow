import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import type { GenerationJob } from '@frs/domain';
import {
  openFrsDb, STORES, put, get, getAll, createJob, mutateJob, listEvents, acquireLock, releaseLock,
  RevisionConflictError, FencingError, StorageError, putBlob, collectGarbage, exportBackup,
  importBackup, validateBackup, sha256Bytes,
} from '@frs/storage';

let n = 0;
const fresh = () => openFrsDb(`frs-test-${++n}`);
const NOW = '2026-01-01T00:00:00.000Z';

const job = (over: Partial<GenerationJob> = {}): GenerationJob => ({
  id: 'job1', parentJobId: null, revision: 1, state: 'DRAFT',
  intent: {} as GenerationJob['intent'], payloadHash: 'p'.repeat(64),
  submitAttemptId: null, manualSubmissionWindowOpenedAt: null, providerJobId: null,
  observedModelLabel: null, observedSettings: {}, bindingId: 'b1', eventSequence: 1,
  createdAt: NOW, updatedAt: NOW, ...over,
});

describe('schema and migrations (DATA-01)', () => {
  it('creates every store and records migration 1', async () => {
    const db = await fresh();
    expect([...db.objectStoreNames].sort()).toEqual([...STORES].sort());
    const m = await getAll<{ version: number }>(db, 'migrations');
    expect(m.map((x) => x.version)).toEqual([1]);
  });
});

describe('job journal', () => {
  let db: IDBDatabase;
  beforeEach(async () => { db = await fresh(); await createJob(db, job(), NOW); });

  it('writes the job and exactly one event together', async () => {
    const next = await mutateJob(db, 'job1', { expectedRevision: 1, to: 'VALIDATING', event: { type: 'validate' }, now: NOW });
    expect([next.revision, next.eventSequence, next.state]).toEqual([2, 2, 'VALIDATING']);
    const ev = await listEvents(db, 'job1');
    expect(ev.map((e) => [e.seq, e.from, e.to])).toEqual([[1, null, 'DRAFT'], [2, 'DRAFT', 'VALIDATING']]);
  });

  it('rejects a stale revision and writes nothing', async () => {
    await mutateJob(db, 'job1', { expectedRevision: 1, to: 'VALIDATING', event: { type: 'a' }, now: NOW });
    await expect(mutateJob(db, 'job1', { expectedRevision: 1, to: 'READY', event: { type: 'b' }, now: NOW }))
      .rejects.toBeInstanceOf(RevisionConflictError);
    expect((await get<GenerationJob>(db, 'jobs', 'job1'))!.state).toBe('VALIDATING');
    expect(await listEvents(db, 'job1')).toHaveLength(2);
  });

  it('rolls back on an invalid transition: no state change, no event', async () => {
    await expect(mutateJob(db, 'job1', { expectedRevision: 1, to: 'COMPLETED', event: { type: 'x' }, now: NOW })).rejects.toThrow();
    const j = (await get<GenerationJob>(db, 'jobs', 'job1'))!;
    expect([j.state, j.revision]).toEqual(['DRAFT', 1]);
    expect(await listEvents(db, 'job1')).toHaveLength(1);
  });

  it('refuses to patch immutable fields such as the intent or payload hash', async () => {
    await expect(mutateJob(db, 'job1', { expectedRevision: 1, patch: { payloadHash: 'x' } as never, event: { type: 'x' }, now: NOW }))
      .rejects.toMatchObject({ code: 'IMMUTABLE_FIELD' });
  });

  it('never allows SUBMITTING back to READY (no automatic re-submit)', async () => {
    await put(db, 'jobs', job({ state: 'SUBMITTING', revision: 5, eventSequence: 5 }));
    await expect(mutateJob(db, 'job1', { expectedRevision: 5, to: 'READY', event: { type: 'retry' }, now: NOW })).rejects.toThrow();
    const ok = await mutateJob(db, 'job1', { expectedRevision: 5, to: 'NEEDS_RECONCILIATION', event: { type: 'reload' }, now: NOW });
    expect(ok.state).toBe('NEEDS_RECONCILIATION');
  });
});

describe('lock fencing', () => {
  it('gives a new owner a higher epoch, and the old owner can no longer write', async () => {
    const db = await fresh();
    await createJob(db, job(), NOW);
    const a = (await acquireLock(db, 'queue', 'tabA', 1000, 0))!;
    expect(await acquireLock(db, 'queue', 'tabB', 1000, 500)).toBeNull();
    const b = (await acquireLock(db, 'queue', 'tabB', 1000, 2000))!;
    expect(b.epoch).toBeGreaterThan(a.epoch);

    const stale = { name: 'queue', owner: 'tabA', epoch: a.epoch, nowMs: 2100 };
    await expect(mutateJob(db, 'job1', { expectedRevision: 1, to: 'VALIDATING', event: { type: 'x' }, now: NOW, fence: stale }))
      .rejects.toBeInstanceOf(FencingError);
    expect((await get<GenerationJob>(db, 'jobs', 'job1'))!.revision).toBe(1);

    const fresh2 = { name: 'queue', owner: 'tabB', epoch: b.epoch, nowMs: 2100 };
    await expect(mutateJob(db, 'job1', { expectedRevision: 1, to: 'VALIDATING', event: { type: 'x' }, now: NOW, fence: fresh2 }))
      .resolves.toMatchObject({ revision: 2 });
    expect(await releaseLock(db, 'queue', 'tabA', a.epoch)).toBe(false);
    expect(await releaseLock(db, 'queue', 'tabB', b.epoch)).toBe(true);
  });
});

describe('blob garbage collection', () => {
  it('deletes only unreachable blobs and honours dryRun', async () => {
    const db = await fresh();
    await putBlob(db, 'used', 'image/png', new Uint8Array([1]));
    await putBlob(db, 'mask', 'image/png', new Uint8Array([2]));
    await putBlob(db, 'orphan', 'image/png', new Uint8Array([3]));
    await put(db, 'assets', { id: 'a1', originalBlobKey: 'used', normalizedBlobKey: 'used' });
    await put(db, 'masks', { id: 'm1', allowedMaskBlobKey: 'mask', protectedMaskBlobKey: 'mask' });

    expect(await collectGarbage(db, { dryRun: true })).toEqual(['orphan']);
    expect(await getAll(db, 'blobs')).toHaveLength(3);
    expect(await collectGarbage(db)).toEqual(['orphan']);
    expect((await getAll<{ key: string }>(db, 'blobs')).map((b) => b.key).sort()).toEqual(['mask', 'used']);
  });

  it('refuses blob keys that look like paths', async () => {
    const db = await fresh();
    await expect(putBlob(db, '../evil', 'image/png', new Uint8Array([1]))).rejects.toMatchObject({ code: 'BAD_BLOB_KEY' });
  });
});

describe('backup export/import', () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  /** Recomputes the checksum so a test can reach the deeper validation checks. */
  async function resign(file: Record<string, unknown>) {
    const { checksum: _drop, ...body } = file;
    return { ...body, checksum: await sha256Bytes(enc(JSON.stringify(body))) };
  }
  async function seeded() {
    const db = await fresh();
    await put(db, 'projects', { id: 'p1', name: 'Demo' });
    await putBlob(db, 'blob1', 'image/png', new Uint8Array([137, 80, 78, 71]));
    await put(db, 'assets', { id: 'a1', originalBlobKey: 'blob1', normalizedBlobKey: 'blob1' });
    await createJob(db, job(), NOW);
    return db;
  }

  it('round-trips records, events and blob bytes into an empty database', async () => {
    const backup = await exportBackup(await seeded(), NOW);
    const target = await fresh();
    const r = await importBackup(target, JSON.parse(JSON.stringify(backup)));
    expect(r.blobs).toBe(1);
    expect((await get<{ name: string }>(target, 'projects', 'p1'))!.name).toBe('Demo');
    expect(await listEvents(target, 'job1')).toHaveLength(1);
    expect([...(await get<{ bytes: Uint8Array }>(target, 'blobs', 'blob1'))!.bytes]).toEqual([137, 80, 78, 71]);
  });

  it('rejects an edited file whose checksum no longer matches', async () => {
    const backup = JSON.parse(JSON.stringify(await exportBackup(await seeded(), NOW)));
    backup.stores.projects[0].name = 'Hacked';
    await expect(validateBackup(backup)).rejects.toMatchObject({ code: 'BACKUP_CHECKSUM' });
  });

  it('rejects a blob whose bytes do not match its hash, even with a valid checksum', async () => {
    const backup = JSON.parse(JSON.stringify(await exportBackup(await seeded(), NOW)));
    backup.blobs[0].base64 = btoa('tampered');
    await expect(validateBackup(await resign(backup))).rejects.toMatchObject({ code: 'BACKUP_BLOB_HASH' });
  });

  it('rejects path traversal in blob keys and unknown stores', async () => {
    const backup = JSON.parse(JSON.stringify(await exportBackup(await seeded(), NOW)));
    const traversal = { ...backup, blobs: [{ ...backup.blobs[0], key: '../../etc/passwd' }] };
    await expect(validateBackup(await resign(traversal))).rejects.toMatchObject({ code: 'BACKUP_BLOB_KEY' });
    const extra = { ...backup, stores: { ...backup.stores, locks: [] } };
    await expect(validateBackup(await resign(extra))).rejects.toMatchObject({ code: 'BACKUP_UNKNOWN_STORE' });
  });

  it('rejects a backup from a newer schema', async () => {
    const backup = JSON.parse(JSON.stringify(await exportBackup(await seeded(), NOW)));
    await expect(validateBackup(await resign({ ...backup, schemaVersion: 99 }))).rejects.toMatchObject({ code: 'BACKUP_SCHEMA_TOO_NEW' });
  });

  it('refuses to import over existing data and leaves it untouched', async () => {
    const backup = JSON.parse(JSON.stringify(await exportBackup(await seeded(), NOW)));
    const target = await fresh();
    await put(target, 'projects', { id: 'keep', name: 'Mine' });
    await expect(importBackup(target, backup)).rejects.toBeInstanceOf(StorageError);
    expect((await getAll<{ id: string }>(target, 'projects')).map((p) => p.id)).toEqual(['keep']);
    expect(await getAll(target, 'blobs')).toHaveLength(0);
  });
});
