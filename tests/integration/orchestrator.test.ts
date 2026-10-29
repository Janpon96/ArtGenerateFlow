import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import type { GenerationJob } from '@frs/domain';
import { openFrsDb, createJob, get, listEvents, FencingError } from '@frs/storage';
import { JobOrchestrator, OrchestratorError } from '@frs/job-orchestrator';
import { MockProvider } from '@frs/provider-mock';

let n = 0;
const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const NOW = new Date(T0).toISOString();

function makeJob(over: Partial<GenerationJob> = {}, mode: 'mock' | 'assisted' = 'mock', maxAttempts = 1): GenerationJob {
  return {
    id: 'job1', parentJobId: null, revision: 1, state: 'DRAFT',
    intent: { executionMode: mode, maxGenerationAttempts: maxAttempts, orderedAssetIds: ['a1'], projectId: 'p1' } as unknown as GenerationJob['intent'],
    payloadHash: 'p'.repeat(64), submitAttemptId: null, manualSubmissionWindowOpenedAt: null,
    providerJobId: null, observedModelLabel: null, observedSettings: {}, bindingId: 'b1',
    eventSequence: 1, createdAt: NOW, updatedAt: NOW, ...over,
  };
}

async function setup(job: GenerationJob, scenario: ConstructorParameters<typeof MockProvider>[0] = {}, owner = 'tab-A') {
  const db = await openFrsDb(`frs-orch-${++n}`);
  await createJob(db, job, NOW);
  const provider = new MockProvider(scenario);
  let ids = 0;
  const orch = new JobOrchestrator(db, provider, { owner, lockTtlMs: 60_000, nowMs: () => T0, newId: () => `attempt-${++ids}` });
  expect(await orch.acquire()).toBe(true);
  return { db, provider, orch };
}

const state = async (db: IDBDatabase) => (await get<GenerationJob>(db, 'jobs', 'job1'))!.state;

describe('job orchestrator with MOCK provider (JOB-01)', () => {
  it('journals the attempt before submit and submits exactly once', async () => {
    const { db, provider, orch } = await setup(makeJob());
    const job = await orch.start('job1');
    expect(job.state).toBe('OBSERVING');
    expect(provider.submitCalls).toHaveLength(1);
    const types = (await listEvents(db, 'job1')).map((e) => e.type);
    expect(types.indexOf('submit.started')).toBeGreaterThan(-1);
    expect(types.indexOf('submit.started')).toBeLessThan(types.indexOf('submit.accepted'));
  });

  it.each(['unknown', 'throws'] as const)('submit outcome "%s" goes to NEEDS_RECONCILIATION without a second submit', async (submit) => {
    const { db, provider, orch } = await setup(makeJob(), {
      submit, reconcile: { status: 'ambiguous', reason: 'MOCK: cannot tell' },
    });
    expect((await orch.start('job1')).state).toBe('NEEDS_RECONCILIATION');
    // an ambiguous reconcile result must not trigger another submit either
    await orch.reconcile('job1');
    expect(await state(db)).toBe('NEEDS_RECONCILIATION');
    expect(provider.submitCalls).toHaveLength(1);
  });

  it('a job found in SUBMITTING after a crash is reconciled, never re-submitted', async () => {
    const { db, provider, orch } = await setup(makeJob({ state: 'SUBMITTING', submitAttemptId: 'attempt-x' }));
    expect(await orch.recover()).toEqual(['job1']);
    expect(await state(db)).toBe('NEEDS_RECONCILIATION');
    expect(provider.submitCalls).toHaveLength(0);
  });

  it('assisted mode waits for the user and never calls submit', async () => {
    const { db, provider, orch } = await setup(makeJob({}, 'assisted'));
    const job = await orch.start('job1');
    expect(job.state).toBe('AWAITING_USER');
    expect(job.manualSubmissionWindowOpenedAt).not.toBeNull();
    expect(provider.submitCalls).toHaveLength(0);
    // reload while the user may or may not have pressed Generate
    await orch.recover();
    expect(await state(db)).toBe('NEEDS_RECONCILIATION');
    expect(provider.submitCalls).toHaveLength(0);
  });

  it('read-back mismatch stops before submit', async () => {
    const { db, provider, orch } = await setup(makeJob(), { readBackMatches: false });
    await expect(orch.start('job1')).rejects.toMatchObject({ code: 'READBACK_MISMATCH' });
    expect(await state(db)).toBe('FAILED');
    expect(provider.submitCalls).toHaveLength(0);
  });

  it('a rejected submit ends FAILED and is not retried', async () => {
    const { db, provider, orch } = await setup(makeJob(), { submit: 'rejected' });
    expect((await orch.start('job1')).state).toBe('FAILED');
    expect(provider.submitCalls).toHaveLength(1);
    expect(await state(db)).toBe('FAILED');
  });

  it('rejects a writer whose lock was taken over (stale lock)', async () => {
    const { db, orch } = await setup(makeJob());
    // tab-B takes the lock after tab-A's TTL ran out
    const other = new JobOrchestrator(db, new MockProvider(), { owner: 'tab-B', lockTtlMs: 60_000, nowMs: () => T0 + 120_000 });
    expect(await other.acquire()).toBe(true);
    await expect(orch.start('job1')).rejects.toBeInstanceOf(FencingError);
    expect(await state(db)).toBe('DRAFT');
  });

  it('refuses to write without the lock', async () => {
    const { orch } = await setup(makeJob());
    await orch.release();
    await expect(orch.start('job1')).rejects.toBeInstanceOf(OrchestratorError);
  });

  it('cancel: confirmed -> CANCELLED, unconfirmed -> NEEDS_RECONCILIATION', async () => {
    const a = await setup(makeJob());
    await a.orch.start('job1');
    expect((await a.orch.cancel('job1')).state).toBe('CANCELLED');

    const b = await setup(makeJob(), { cancel: 'unknown' });
    await b.orch.start('job1');
    expect((await b.orch.cancel('job1')).state).toBe('NEEDS_RECONCILIATION');
  });

  it('reconcile "found" moves to RESULT_READY', async () => {
    const { orch } = await setup(makeJob(), {
      submit: 'unknown', reconcile: { status: 'found', resultLocators: ['loc1'], evidence: 'MOCK' },
    });
    await orch.start('job1');
    expect((await orch.reconcile('job1')).state).toBe('RESULT_READY');
  });
});
