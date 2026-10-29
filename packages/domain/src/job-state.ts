import type { JobState } from './types';

/**
 * Allowed job transitions, from docs/03 section 7.
 * Auxiliary states (PAUSED, FAILED, CANCEL_REQUESTED, CANCELLED, ABANDONED)
 * are reachable from any non-terminal state, with the exceptions below.
 *
 * SUBMITTING and AWAITING_USER never return to READY: an unknown submission
 * must go through NEEDS_RECONCILIATION, never an automatic re-submit.
 */
const MAIN: Record<JobState, JobState[]> = {
  DRAFT: ['VALIDATING'],
  VALIDATING: ['READY', 'BLOCKED'],
  READY: ['PREPARING'],
  BLOCKED: [],
  PREPARING: ['AWAITING_USER', 'SUBMITTING'],
  AWAITING_USER: ['OBSERVING', 'NEEDS_RECONCILIATION'],
  SUBMITTING: ['OBSERVING', 'NEEDS_RECONCILIATION'],
  OBSERVING: ['RESULT_READY', 'NEEDS_RECONCILIATION'],
  NEEDS_RECONCILIATION: ['OBSERVING', 'RESULT_READY'],
  RESULT_READY: ['VERIFYING'],
  VERIFYING: ['REVIEW', 'BLOCKED'],
  REVIEW: ['COMPLETED'],
  COMPLETED: [],
  PAUSED: [],
  FAILED: [],
  CANCEL_REQUESTED: ['CANCELLED', 'NEEDS_RECONCILIATION'],
  CANCELLED: [],
  ABANDONED: [],
};

const TERMINAL: ReadonlySet<JobState> = new Set<JobState>(['COMPLETED', 'FAILED', 'CANCELLED', 'ABANDONED']);
const AUX: JobState[] = ['PAUSED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED', 'ABANDONED'];

export function isTerminal(state: JobState): boolean {
  return TERMINAL.has(state);
}

export function canTransition(from: JobState, to: JobState): boolean {
  if (MAIN[from].includes(to)) return true;
  if (isTerminal(from)) return false;
  // Once submission may have reached Flow, only reconcile/observe paths are allowed
  // besides cancel request and abandon. Never PAUSED -> READY style resubmits.
  if (from === 'SUBMITTING' || from === 'AWAITING_USER') {
    return to === 'CANCEL_REQUESTED' || to === 'ABANDONED' || to === 'PAUSED';
  }
  return AUX.includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(public readonly from: JobState, public readonly to: JobState) {
    super(`Invalid job transition ${from} -> ${to}`);
  }
}

export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}
