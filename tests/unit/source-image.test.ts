import { describe, it, expect } from 'vitest';
import { fitSize, fmtMB, MAX_SIDE } from '../../apps/extension/src/source-image';

describe('source image helpers', () => {
  it('never enlarges and keeps the aspect ratio when shrinking', () => {
    expect(fitSize(1000, 500, MAX_SIDE)).toEqual({ width: 1000, height: 500 });
    expect(fitSize(5120, 2880, MAX_SIDE)).toEqual({ width: 2560, height: 1440 });
    expect(fitSize(2880, 5120, MAX_SIDE)).toEqual({ width: 1440, height: 2560 });
  });

  it('never returns a zero side', () => {
    expect(fitSize(10000, 1, 100).height).toBe(1);
  });

  it('formats sizes in MB', () => {
    expect(fmtMB(15200067)).toBe('14.5 MB');
  });
});
