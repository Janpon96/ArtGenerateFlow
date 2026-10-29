import { describe, it, expect } from 'vitest';
import { canTransition, assertTransition, InvalidTransitionError } from '@frs/domain';

describe('job state machine invariants', () => {
  it('never returns SUBMITTING or AWAITING_USER to READY/PREPARING (no auto re-submit)', () => {
    for (const from of ['SUBMITTING', 'AWAITING_USER'] as const) {
      expect(canTransition(from, 'READY')).toBe(false);
      expect(canTransition(from, 'PREPARING')).toBe(false);
      expect(canTransition(from, 'SUBMITTING')).toBe(false);
    }
  });

  it('routes unknown submission to reconciliation', () => {
    expect(canTransition('SUBMITTING', 'NEEDS_RECONCILIATION')).toBe(true);
    expect(canTransition('AWAITING_USER', 'NEEDS_RECONCILIATION')).toBe(true);
    expect(canTransition('NEEDS_RECONCILIATION', 'OBSERVING')).toBe(true);
    expect(canTransition('NEEDS_RECONCILIATION', 'SUBMITTING')).toBe(false);
  });

  it('terminal states have no outgoing transitions', () => {
    for (const from of ['COMPLETED', 'FAILED', 'CANCELLED', 'ABANDONED'] as const) {
      expect(canTransition(from, 'DRAFT')).toBe(false);
      expect(canTransition(from, 'OBSERVING')).toBe(false);
    }
  });

  it('follows the happy path', () => {
    const path = ['DRAFT', 'VALIDATING', 'READY', 'PREPARING', 'SUBMITTING', 'OBSERVING',
      'RESULT_READY', 'VERIFYING', 'REVIEW', 'COMPLETED'] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it('assertTransition throws a typed error', () => {
    expect(() => assertTransition('READY', 'COMPLETED')).toThrow(InvalidTransitionError);
  });
});
