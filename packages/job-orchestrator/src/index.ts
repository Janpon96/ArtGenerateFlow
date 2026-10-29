import type { GenerationJob, JobState, ProviderAdapter } from '@frs/domain';
import {
  acquireLock, releaseLock, mutateJob, listEvents, get, getAll,
  type LockRecord, type MutateJobOptions,
} from '@frs/storage';

/**
 * Journalled job orchestrator (JOB-01).
 * Rules enforced here:
 *  - every state change goes through mutateJob (fence + revision + transition + one event);
 *  - the submit attempt is journalled BEFORE the adapter is called;
 *  - an unknown submit outcome or a crash while SUBMITTING/AWAITING_USER leads to
 *    NEEDS_RECONCILIATION and never to an automatic second submit;
 *  - maxGenerationAttempts is a ceiling, not a retry policy.
 */
export const LOCK_NAME = 'job-orchestrator';

export interface OrchestratorOptions {
  owner: string;
  lockTtlMs?: number;
  nowMs?: () => number;
  newId?: () => string;
}

export class OrchestratorError extends Error {
  constructor(public readonly code: 'NO_LOCK' | 'NOT_FOUND' | 'ATTEMPTS_EXHAUSTED' | 'BAD_STATE' | 'READBACK_MISMATCH', message: string) {
    super(message);
  }
}

export class JobOrchestrator {
  private lock: LockRecord | null = null;
  private readonly nowMs: () => number;
  private readonly ttl: number;
  private readonly newId: () => string;

  constructor(
    private readonly db: IDBDatabase,
    private readonly adapter: ProviderAdapter,
    private readonly opts: OrchestratorOptions,
  ) {
    this.nowMs = opts.nowMs ?? Date.now;
    this.ttl = opts.lockTtlMs ?? 30_000;
    this.newId = opts.newId ?? (() => crypto.randomUUID());
  }

  async acquire(): Promise<boolean> {
    this.lock = await acquireLock(this.db, LOCK_NAME, this.opts.owner, this.ttl, this.nowMs());
    return this.lock !== null;
  }

  async release(): Promise<void> {
    if (this.lock) await releaseLock(this.db, LOCK_NAME, this.lock.owner, this.lock.epoch);
    this.lock = null;
  }

  private async load(jobId: string): Promise<GenerationJob> {
    const job = await get<GenerationJob>(this.db, 'jobs', jobId);
    if (!job) throw new OrchestratorError('NOT_FOUND', `Job ${jobId} does not exist.`);
    return job;
  }

  private step(
    job: GenerationJob, to: JobState | undefined, type: string,
    patch?: MutateJobOptions['patch'], detail?: Record<string, unknown>,
  ): Promise<GenerationJob> {
    if (!this.lock) return Promise.reject(new OrchestratorError('NO_LOCK', 'Acquire the orchestrator lock first.'));
    const nowMs = this.nowMs();
    return mutateJob(this.db, job.id, {
      expectedRevision: job.revision,
      to,
      patch,
      event: { type, detail },
      now: new Date(nowMs).toISOString(),
      fence: { name: LOCK_NAME, owner: this.lock.owner, epoch: this.lock.epoch, nowMs },
    });
  }

  /** DRAFT -> ... -> AWAITING_USER (assisted) or SUBMITTING (other modes, e.g. mock). */
  async start(jobId: string): Promise<GenerationJob> {
    let job = await this.load(jobId);
    if (job.state !== 'DRAFT') throw new OrchestratorError('BAD_STATE', `start needs DRAFT, got ${job.state}.`);
    job = await this.step(job, 'VALIDATING', 'job.validating');
    job = await this.step(job, 'READY', 'job.ready');
    job = await this.step(job, 'PREPARING', 'job.preparing');

    const prepared = await this.adapter.prepare(job);
    const back = await this.adapter.readBack(prepared);
    if (!back.matchesIntent) {
      // BLOCKED is not reachable from PREPARING in the table; FAILED is, and nothing was submitted.
      await this.step(job, 'FAILED', 'readback.mismatch', undefined, { uncertainties: back.uncertainties });
      throw new OrchestratorError('READBACK_MISMATCH', 'Provider settings do not match the job intent. Nothing was submitted.');
    }

    if (job.intent.executionMode === 'assisted') {
      return this.step(job, 'AWAITING_USER', 'assisted.awaiting_user',
        { manualSubmissionWindowOpenedAt: new Date(this.nowMs()).toISOString(), bindingId: prepared.bindingId });
    }
    return this.submit(job, prepared);
  }

  private async submit(job: GenerationJob, prepared: Awaited<ReturnType<ProviderAdapter['prepare']>>): Promise<GenerationJob> {
    const attempts = (await listEvents(this.db, job.id)).filter((e) => e.type === 'submit.started').length;
    if (attempts >= job.intent.maxGenerationAttempts) {
      await this.step(job, 'FAILED', 'submit.ceiling_reached', undefined, { attempts });
      throw new OrchestratorError('ATTEMPTS_EXHAUSTED', 'maxGenerationAttempts reached. Create a new job to try again.');
    }
    const attemptId = this.newId();
    // Journal first: if we crash after this write the job is found SUBMITTING and reconciled.
    job = await this.step(job, 'SUBMITTING', 'submit.started', { submitAttemptId: attemptId }, { attemptId });
    let outcome;
    try {
      outcome = await this.adapter.submit(prepared, attemptId);
    } catch (e) {
      return this.step(job, 'NEEDS_RECONCILIATION', 'submit.threw', undefined, { message: String(e) });
    }
    switch (outcome.status) {
      case 'accepted':
        return this.step(job, 'OBSERVING', 'submit.accepted', { providerJobId: outcome.providerJobId }, { evidence: outcome.evidence });
      case 'rejected': {
        const j = await this.step(job, 'NEEDS_RECONCILIATION', 'submit.rejected', undefined, { code: outcome.code, message: outcome.message });
        return this.step(j, 'FAILED', 'submit.rejected.final', undefined, { code: outcome.code });
      }
      default:
        return this.step(job, 'NEEDS_RECONCILIATION', 'submit.unknown', undefined, { reason: outcome.reason });
    }
  }

  /** The user says they pressed Generate in Flow themselves. */
  async confirmManualSubmit(jobId: string): Promise<GenerationJob> {
    const job = await this.load(jobId);
    if (job.state !== 'AWAITING_USER') throw new OrchestratorError('BAD_STATE', `Needs AWAITING_USER, got ${job.state}.`);
    return this.step(job, 'OBSERVING', 'assisted.user_confirmed_submit');
  }

  /** After a reload: submissions that may have reached the provider are never re-sent. */
  async recover(): Promise<string[]> {
    const touched: string[] = [];
    for (const job of await getAll<GenerationJob>(this.db, 'jobs')) {
      if (job.state === 'SUBMITTING' || job.state === 'AWAITING_USER') {
        await this.step(job, 'NEEDS_RECONCILIATION', 'recovered.unknown_submission');
        touched.push(job.id);
      } else if (job.state === 'PREPARING') {
        await this.step(job, 'FAILED', 'recovered.interrupted_before_submit');
        touched.push(job.id);
      }
    }
    return touched;
  }

  async reconcile(jobId: string): Promise<GenerationJob> {
    const job = await this.load(jobId);
    if (job.state !== 'NEEDS_RECONCILIATION') throw new OrchestratorError('BAD_STATE', `Needs NEEDS_RECONCILIATION, got ${job.state}.`);
    const r = await this.adapter.reconcile(job);
    switch (r.status) {
      case 'running': return this.step(job, 'OBSERVING', 'reconcile.running', undefined, { evidence: r.evidence });
      case 'found': return this.step(job, 'RESULT_READY', 'reconcile.found', undefined, { resultLocators: r.resultLocators, evidence: r.evidence });
      case 'definitely_absent': return this.step(job, 'FAILED', 'reconcile.absent', undefined, { evidence: r.evidence });
      default: return this.step(job, undefined, 'reconcile.ambiguous', undefined, { reason: r.reason });
    }
  }

  /**
   * Records that result images were collected (by the adapter or imported by the user).
   * The slow collect itself runs outside the lock; only this short state step needs it.
   */
  async recordResults(jobId: string, assetIds: string[]): Promise<GenerationJob> {
    const job = await this.load(jobId);
    if (job.state !== 'OBSERVING' && job.state !== 'NEEDS_RECONCILIATION') {
      throw new OrchestratorError('BAD_STATE', `Needs OBSERVING or NEEDS_RECONCILIATION, got ${job.state}.`);
    }
    if (assetIds.length === 0) throw new OrchestratorError('BAD_STATE', 'No result assets to record.');
    return this.step(job, 'RESULT_READY', 'results.collected', undefined, { assetIds });
  }

  async cancel(jobId: string): Promise<GenerationJob> {
    let job = await this.load(jobId);
    job = await this.step(job, 'CANCEL_REQUESTED', 'cancel.requested');
    const res = await this.adapter.cancel(job);
    return res.status === 'confirmed_cancelled'
      ? this.step(job, 'CANCELLED', 'cancel.confirmed', undefined, { evidence: res.evidence })
      : this.step(job, 'NEEDS_RECONCILIATION', 'cancel.unconfirmed', undefined, { status: res.status, evidence: res.evidence });
  }
}
