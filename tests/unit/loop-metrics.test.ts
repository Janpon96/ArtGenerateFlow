import { describe, it, expect } from 'vitest';
import { frameDiff, calculateLoopMetrics } from '@frs/image-core';

describe('loop-metrics', () => {
  it('returns 0 diff for identical frames', () => {
    const a = new Uint8Array([10, 20, 30, 40]);
    const b = new Uint8Array([10, 20, 30, 40]);
    expect(frameDiff(a, b)).toBe(0);
  });

  it('calculates perfect loop score for circular sequence', () => {
    const f1 = { rgba: new Uint8Array([10, 10, 10, 10]) };
    const f2 = { rgba: new Uint8Array([20, 20, 20, 20]) };
    const f3 = { rgba: new Uint8Array([30, 30, 30, 30]) };
    const f4 = { rgba: new Uint8Array([20, 20, 20, 20]) };

    const metrics = calculateLoopMetrics([f1, f2, f3, f4]);
    expect(metrics.loopScore).toBe(1);
    expect(metrics.seamless).toBe(true);
  });

  it('penalizes loop score when last frame does not match first frame', () => {
    const f1 = { rgba: new Uint8Array([10, 10, 10, 10]) };
    const f2 = { rgba: new Uint8Array([12, 12, 12, 12]) };
    const f3 = { rgba: new Uint8Array([14, 14, 14, 14]) };
    // f4 nhảy rất xa so với f1
    const f4 = { rgba: new Uint8Array([200, 200, 200, 200]) };

    const metrics = calculateLoopMetrics([f1, f2, f3, f4]);
    expect(metrics.loopScore).toBeLessThan(0.7);
    expect(metrics.seamless).toBe(false);
  });
});
