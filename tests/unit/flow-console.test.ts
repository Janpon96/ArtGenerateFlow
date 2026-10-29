import { describe, expect, it } from 'vitest';
import { modelLabelsMatch, base64FromBytes, bytesFromBase64 } from '@frs/provider-flow-web';
import { LogBuffer, formatLogLine } from '../../apps/extension/src/log-buffer';

describe('model label matching', () => {
  it('treats 2.1 and 2 as the same model', () => {
    expect(modelLabelsMatch('Nano Banana 2', 'Nano Banana 2.1')).toBe(true);
  });
  it('never matches Pro with 2.1', () => {
    expect(modelLabelsMatch('Nano Banana Pro', 'Nano Banana 2.1')).toBe(false);
  });
});

describe('base64 helpers', () => {
  it('round-trips bytes', () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 251);
    expect(Array.from(bytesFromBase64(base64FromBytes(bytes)))).toEqual(Array.from(bytes));
  });
});

describe('LogBuffer', () => {
  it('keeps only the newest entries', () => {
    const b = new LogBuffer(3);
    for (let i = 0; i < 5; i++) b.add('info', `m${i}`);
    expect(b.all().map((e) => e.message)).toEqual(['m2', 'm3', 'm4']);
  });
  it('filters by level and job', () => {
    const b = new LogBuffer(10);
    b.add('info', 'a', 'j1');
    b.add('error', 'b', 'j2');
    expect(b.filtered({ minLevel: 'error', jobId: '' }).map((e) => e.message)).toEqual(['b']);
    expect(b.filtered({ minLevel: 'all', jobId: 'j1' }).map((e) => e.message)).toEqual(['a']);
    expect(b.jobIds().sort()).toEqual(['j1', 'j2']);
  });
  it('formats a line with level and message', () => {
    const b = new LogBuffer(2);
    const line = formatLogLine(b.add('warn', 'hello', 'abcdef123456'));
    expect(line).toContain('WARN');
    expect(line).toContain('hello');
  });
});
