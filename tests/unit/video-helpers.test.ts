import { describe, it, expect } from 'vitest';
import {
  estimateCredits,
  needsCreditConfirm,
  parseTimestamp,
  parseCues,
  validateCues,
  cuesToText,
} from '../../apps/extension/src/video-helpers';

describe('video credits', () => {
  it('estimates by duration and defaults to 0 for unknown', () => {
    expect(estimateCredits(4)).toBe(15);
    expect(estimateCredits(10)).toBe(30);
    expect(estimateCredits(5)).toBe(0);
    expect(estimateCredits(4, { '4': 99 })).toBe(99);
  });

  it('asks for confirmation only above 20 credits', () => {
    expect(needsCreditConfirm(15)).toBe(false);
    expect(needsCreditConfirm(20)).toBe(false);
    expect(needsCreditConfirm(25)).toBe(true);
  });
});

describe('parseTimestamp', () => {
  it('parses seconds and mm:ss', () => {
    expect(parseTimestamp('2.5')).toBe(2.5);
    expect(parseTimestamp('01:05')).toBe(65);
    expect(parseTimestamp('00:00.5')).toBe(0.5);
  });
  it('returns NaN for garbage', () => {
    expect(parseTimestamp('')).toBeNaN();
    expect(parseTimestamp('a:b')).toBeNaN();
    expect(parseTimestamp('1:2:3')).toBeNaN();
  });
});

describe('parseCues', () => {
  it('splits untimed lines evenly over the duration', () => {
    const cues = parseCues('Xin chào\nTạm biệt', 8);
    expect(cues).toEqual([
      { start: 0, end: 4, text: 'Xin chào' },
      { start: 4, end: 8, text: 'Tạm biệt' },
    ]);
  });

  it('parses timed lines in both syntaxes', () => {
    const cues = parseCues('0-2.5 Một\n00:03 --> 00:05 Hai có dấu', 8);
    expect(cues).toEqual([
      { start: 0, end: 2.5, text: 'Một' },
      { start: 3, end: 5, text: 'Hai có dấu' },
    ]);
  });

  it('returns [] for blank input', () => {
    expect(parseCues('  \n ', 8)).toEqual([]);
  });

  it('rejects mixed timed and untimed lines', () => {
    expect(() => parseCues('0-2 Một\nHai', 8)).toThrow(/thời gian/);
  });

  it('rejects overlap, inverted and out-of-range cues', () => {
    expect(() => parseCues('0-3 A\n2-4 B', 8)).toThrow(/chồng/);
    expect(() => parseCues('3-2 A', 8)).toThrow(/lớn hơn/);
    expect(() => parseCues('0-9 A', 8)).toThrow(/vượt quá/);
  });

  it('round-trips through cuesToText', () => {
    const cues = [
      { start: 0, end: 2, text: 'A' },
      { start: 2, end: 4, text: 'B' },
    ];
    expect(parseCues(cuesToText(cues), 8)).toEqual(cues);
    expect(() => validateCues(cues, 8)).not.toThrow();
  });
});
