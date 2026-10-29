import { assertTransition } from '@frs/domain';
import type { GenerationJob, JobState } from '@frs/domain';

export const STORES = [
  'projects', 'assets', 'blobs', 'references', 'prompts', 'masks',
  'capabilities', 'jobs', 'events', 'results', 'locks', 'migrations',
] as const;
export type StoreName = (typeof STORES)[number];

const KEY_PATHS: Partial<Record<StoreName, string | string[]>> = {
  blobs: 'key',
  events: ['jobId', 'seq'],
  locks: 'name',
  migrations: 'version',
};
const keyPathOf = (s: StoreName): string | string[] => KEY_PATHS[s] ?? 'id';

interface Migration {
  version: number;
  name: string;
  up(db: IDBDatabase): void;
}

/** Append-only. Never edit a shipped migration; add a new one. */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial-stores',
    up(db) {
      for (const s of STORES) db.createObjectStore(s, { keyPath: keyPathOf(s) });
    },
  },
];
export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export class StorageError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

export function openFrsDb(name = 'frs'): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, LATEST_SCHEMA_VERSION);
    open.onupgradeneeded = (event) => {
      const db = open.result;
      const tx = open.transaction!;
      for (const m of MIGRATIONS) {
        if (m.version > event.oldVersion) {
          m.up(db);
          tx.objectStore('migrations').put({ version: m.version, name: m.name, appliedAt: new Date().toISOString() });
        }
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => {
      const err = open.error;
      if (err?.name === 'VersionError') {
        reject(new StorageError('SCHEMA_TOO_NEW', 'Database was written by a newer version of the extension. Update the extension; data was not modified.'));
      } else reject(err);
    };
    open.onblocked = () => reject(new StorageError('BLOCKED', 'Database upgrade is blocked by another open tab. Close other Workbench tabs and retry.'));
  });
}

/** Runs fn inside one transaction. Throwing aborts the transaction, so nothing is written. */
export async function run<T>(
  db: IDBDatabase,
  stores: StoreName[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const tx = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new StorageError('ABORTED', 'Transaction aborted'));
  });
  let result: T;
  try {
    result = await fn(tx);
  } catch (e) {
    try { tx.abort(); } catch { /* already finished */ }
    await done.catch(() => undefined);
    throw e;
  }
  await done;
  return result;
}

export const put = (db: IDBDatabase, store: StoreName, value: unknown) =>
  run(db, [store], 'readwrite', async (tx) => { await req(tx.objectStore(store).put(value)); });
export const get = <T>(db: IDBDatabase, store: StoreName, key: IDBValidKey) =>
  run(db, [store], 'readonly', (tx) => req(tx.objectStore(store).get(key)) as Promise<T | undefined>);
export const getAll = <T>(db: IDBDatabase, store: StoreName) =>
  run(db, [store], 'readonly', (tx) => req(tx.objectStore(store).getAll()) as Promise<T[]>);
export const del = (db: IDBDatabase, store: StoreName, key: IDBValidKey) =>
  run(db, [store], 'readwrite', async (tx) => { await req(tx.objectStore(store).delete(key)); });

// ---------------------------------------------------------------- locks

export interface LockRecord { name: string; owner: string; epoch: number; expiresAt: number }

/** Returns the held lock, or null when another owner holds an unexpired lock. A new owner always gets a higher epoch. */
export function acquireLock(db: IDBDatabase, name: string, owner: string, ttlMs: number, now: number): Promise<LockRecord | null> {
  return run(db, ['locks'], 'readwrite', async (tx) => {
    const store = tx.objectStore('locks');
    const cur = (await req(store.get(name))) as LockRecord | undefined;
    if (cur && cur.expiresAt > now && cur.owner !== owner) return null;
    const epoch = cur && cur.owner === owner && cur.expiresAt > now ? cur.epoch : (cur?.epoch ?? 0) + 1;
    const next: LockRecord = { name, owner, epoch, expiresAt: now + ttlMs };
    await req(store.put(next));
    return next;
  });
}

export function releaseLock(db: IDBDatabase, name: string, owner: string, epoch: number): Promise<boolean> {
  return run(db, ['locks'], 'readwrite', async (tx) => {
    const store = tx.objectStore('locks');
    const cur = (await req(store.get(name))) as LockRecord | undefined;
    if (!cur || cur.owner !== owner || cur.epoch !== epoch) return false;
    await req(store.delete(name));
    return true;
  });
}

// ---------------------------------------------------------------- jobs

export interface JobEvent {
  jobId: string;
  seq: number;
  at: string;
  type: string;
  from: JobState | null;
  to: JobState | null;
  detail: Record<string, unknown>;
}

export class RevisionConflictError extends StorageError {
  constructor(public readonly expected: number, public readonly actual: number) {
    super('REVISION_CONFLICT', `Job revision is ${actual}, expected ${expected}. Reload the job before changing it.`);
  }
}
export class FencingError extends StorageError {
  constructor() {
    super('STALE_LOCK', 'This tab no longer owns the job lock. No change was written.');
  }
}

const IMMUTABLE_JOB_FIELDS = ['id', 'intent', 'payloadHash', 'createdAt', 'revision', 'eventSequence', 'state'] as const;

export interface MutateJobOptions {
  expectedRevision: number;
  /** Target state. Validated with assertTransition. */
  to?: JobState;
  patch?: Partial<Omit<GenerationJob, (typeof IMMUTABLE_JOB_FIELDS)[number]>>;
  event: { type: string; detail?: Record<string, unknown> };
  now: string;
  /** When set, the write only succeeds if this owner/epoch still holds the unexpired lock. */
  fence?: { name: string; owner: string; epoch: number; nowMs: number };
}

/**
 * The single write path for a job. In one transaction it checks the fence and revision,
 * validates the transition, updates the job and appends exactly one event.
 */
export function mutateJob(db: IDBDatabase, jobId: string, o: MutateJobOptions): Promise<GenerationJob> {
  for (const k of IMMUTABLE_JOB_FIELDS) {
    if (o.patch && k in o.patch) return Promise.reject(new StorageError('IMMUTABLE_FIELD', `Job field "${k}" cannot be patched.`));
  }
  return run(db, ['jobs', 'events', 'locks'], 'readwrite', async (tx) => {
    if (o.fence) {
      const lock = (await req(tx.objectStore('locks').get(o.fence.name))) as LockRecord | undefined;
      if (!lock || lock.owner !== o.fence.owner || lock.epoch !== o.fence.epoch || lock.expiresAt <= o.fence.nowMs) {
        throw new FencingError();
      }
    }
    const jobs = tx.objectStore('jobs');
    const job = (await req(jobs.get(jobId))) as GenerationJob | undefined;
    if (!job) throw new StorageError('NOT_FOUND', `Job ${jobId} does not exist.`);
    if (job.revision !== o.expectedRevision) throw new RevisionConflictError(o.expectedRevision, job.revision);
    if (o.to && o.to !== job.state) assertTransition(job.state, o.to);

    const seq = job.eventSequence + 1;
    const next: GenerationJob = {
      ...job,
      ...(o.patch ?? {}),
      state: o.to ?? job.state,
      revision: job.revision + 1,
      eventSequence: seq,
      updatedAt: o.now,
    };
    await req(jobs.put(next));
    const event: JobEvent = {
      jobId, seq, at: o.now, type: o.event.type,
      from: job.state, to: next.state, detail: o.event.detail ?? {},
    };
    await req(tx.objectStore('events').add(event));
    return next;
  });
}

export function createJob(db: IDBDatabase, job: GenerationJob, now: string): Promise<void> {
  return run(db, ['jobs', 'events'], 'readwrite', async (tx) => {
    await req(tx.objectStore('jobs').add(job));
    const event: JobEvent = { jobId: job.id, seq: job.eventSequence, at: now, type: 'job.created', from: null, to: job.state, detail: {} };
    await req(tx.objectStore('events').add(event));
  });
}

export function listEvents(db: IDBDatabase, jobId: string): Promise<JobEvent[]> {
  return run(db, ['events'], 'readonly', (tx) =>
    req(tx.objectStore('events').getAll(IDBKeyRange.bound([jobId, 0], [jobId, Number.MAX_SAFE_INTEGER]))) as Promise<JobEvent[]>);
}
