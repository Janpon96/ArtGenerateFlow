import { describe, it, expect } from 'vitest';
import { compilePrompt, hasBlockingWarning, type CompileInput } from '@frs/prompt-core';
import type { ReferenceBinding } from '@frs/domain';

const ref = (id: string, over: Partial<ReferenceBinding> = {}): ReferenceBinding => ({
  id, assetId: `a_${id}`, alias: id, roles: ['identity'], subjectKey: 'girl_a',
  priority: 'primary', includeTraits: [], excludeTraits: [], active: true, ...over,
});

const base = (over: Partial<CompileInput> = {}): CompileInput => ({
  rawBrief: 'Cô gái tưới cây', artStyle: 'Anime 2D', language: 'vi', exactText: [], constraints: [],
  references: [ref('r1'), ref('r2', { roles: ['style'], subjectKey: null })],
  assetHashes: { a_r1: 'h1', a_r2: 'h2' }, ...over,
});

describe('prompt compiler', () => {
  it('is deterministic for the same input and version (PRM-02)', async () => {
    const a = await compilePrompt(base());
    const b = await compilePrompt(base());
    expect(b.compiledText).toBe(a.compiledText);
    expect(b.compiledHash).toBe(a.compiledHash);
    expect(b.sourceMap).toEqual(a.sourceMap);
  });

  it('source map follows the upload order, base first, and skips inactive refs', async () => {
    const doc = await compilePrompt(base({
      base: { assetId: 'a_base' },
      assetHashes: { a_base: 'hb', a_r1: 'h1', a_r2: 'h2', a_r3: 'h3' },
      references: [ref('r2', { roles: ['style'], subjectKey: null }), ref('r3', { active: false }), ref('r1')],
    }));
    expect(doc.sourceMap.map((s) => [s.inputIndex, s.assetId, s.purpose])).toEqual([
      [1, 'a_base', 'base'], [2, 'a_r2', 'reference'], [3, 'a_r1', 'reference'],
    ]);
  });

  it('blocks keep-vs-change on the same subject trait (PRM-01)', async () => {
    const doc = await compilePrompt(base({
      constraints: [
        { subjectKey: 'girl_a', attribute: 'hair color', value: 'black', operation: 'preserve', sourceRefId: null },
        { subjectKey: 'girl_a', attribute: 'hair color', value: 'red', operation: 'change_to', sourceRefId: null },
      ],
    }));
    expect(doc.warnings.some((w) => w.code === 'CONFLICT_TRAIT')).toBe(true);
    expect(hasBlockingWarning(doc)).toBe(true);
  });

  it('does not flag different attributes or different subjects', async () => {
    const doc = await compilePrompt(base({
      constraints: [
        { subjectKey: 'girl_a', attribute: 'hair', value: 'black', operation: 'preserve', sourceRefId: null },
        { subjectKey: 'girl_b', attribute: 'hair', value: 'red', operation: 'change_to', sourceRefId: null },
      ],
    }));
    expect(doc.warnings.find((w) => w.code === 'CONFLICT_TRAIT')).toBeUndefined();
  });

  it('requires a subject for identity/outfit/pose roles', async () => {
    const doc = await compilePrompt(base({ references: [ref('r1', { subjectKey: null })] }));
    expect(doc.warnings.some((w) => w.code === 'MISSING_SUBJECT' && w.severity === 'blocking')).toBe(true);
  });

  it('keeps Vietnamese exact text and raw brief untouched (PRM-03)', async () => {
    const doc = await compilePrompt(base({ exactText: ['Quán Cà Phê Ánh Dương'] }));
    expect(doc.compiledText).toContain('"Quán Cà Phê Ánh Dương"');
    expect(doc.rawBrief).toBe('Cô gái tưới cây');
  });
});

describe('@handle mentions', () => {
  const three = (): ReferenceBinding[] => [
    ref('r1', { handle: 'hinh1', roles: ['composition'], subjectKey: null }),
    ref('r2', { handle: 'hinh2', roles: ['identity'], subjectKey: 'hero' }),
    ref('r3', { handle: 'hinh3', roles: ['pose'], subjectKey: 'hero' }),
  ];
  const mk = (over: Partial<CompileInput> = {}): CompileInput => ({
    rawBrief: 'vẽ lại @hinh1 dựa vào nhân vật @hinh2, bám sát pose của @hinh3',
    artStyle: '', language: 'vi', exactText: [], constraints: [], references: three(),
    assetHashes: { a_r1: 'h1', a_r2: 'h2', a_r3: 'h3' }, ...over,
  });

  it('resolves each @handle to its Image N and keeps the other words', async () => {
    const doc = await compilePrompt(mk());
    expect(doc.compiledText).toContain(
      'vẽ lại Image 1 (@hinh1) dựa vào nhân vật Image 2 (@hinh2), bám sát pose của Image 3 (@hinh3)',
    );
    expect(doc.compiledText).toContain('Image 2 [@hinh2 - r2]: use only for identity');
    expect(doc.rawBrief).toContain('@hinh2');
    expect(doc.warnings).toEqual([]);
  });

  it('keeps pointing at the same image after a reorder', async () => {
    const [a, b, c] = three();
    const doc = await compilePrompt(mk({ references: [c!, a!, b!] }));
    expect(doc.compiledText).toContain('Image 2 (@hinh1)');
    expect(doc.compiledText).toContain('Image 3 (@hinh2)');
    expect(doc.compiledText).toContain('Image 1 (@hinh3)');
  });

  it('skips switched-off images when numbering and blocks a mention of one', async () => {
    const [a, b, c] = three();
    const doc = await compilePrompt(mk({ references: [a!, { ...b!, active: false }, c!] }));
    expect(doc.compiledText).toContain('Image 2 (@hinh3)');
    expect(doc.warnings.some((w) => w.code === 'INACTIVE_MENTION' && w.severity === 'blocking')).toBe(true);
  });

  it('offsets the numbers by one when a base image is set', async () => {
    const [, b, c] = three();
    const doc = await compilePrompt(mk({
      base: { assetId: 'a_r1', handle: 'hinh1', alias: 'r1' },
      references: [b!, c!],
    }));
    expect(doc.compiledText).toContain('vẽ lại Image 1 (@hinh1) dựa vào nhân vật Image 2 (@hinh2)');
    expect(doc.compiledText).toContain('Image 1 [@hinh1]: base image to edit');
    expect(doc.warnings).toEqual([]);
  });

  it('blocks an unknown mention and leaves the text as written', async () => {
    const doc = await compilePrompt(mk({ rawBrief: 'dùng @hinh9 làm nền' }));
    expect(doc.warnings.some((w) => w.code === 'UNKNOWN_MENTION' && w.severity === 'blocking')).toBe(true);
    expect(doc.compiledText).toContain('dùng @hinh9 làm nền');
  });

  it('blocks duplicate and invalid handles', async () => {
    const [a, b] = three();
    const dup = await compilePrompt(mk({ references: [a!, { ...b!, handle: 'HINH1' }] }));
    expect(dup.warnings.some((w) => w.code === 'DUPLICATE_HANDLE')).toBe(true);
    const bad = await compilePrompt(mk({ references: [{ ...a!, handle: 'hình 1!' }] }));
    expect(bad.warnings.some((w) => w.code === 'INVALID_HANDLE')).toBe(true);
  });

  it('matches handles without regard to case or diacritics', async () => {
    const doc = await compilePrompt(mk({ rawBrief: 'vẽ @Hinh2 theo @HÌNH1' }));
    expect(doc.warnings.some((w) => w.code === 'UNKNOWN_MENTION')).toBe(false);
    expect(doc.compiledText).toContain('vẽ Image 2 (@hinh2) theo Image 1 (@hinh1)');
  });

  it('does not treat an e-mail address as a mention', async () => {
    const doc = await compilePrompt(mk({ rawBrief: 'liên hệ a@hinh1.com', exactText: [] }));
    expect(doc.warnings.some((w) => w.code === 'UNKNOWN_MENTION')).toBe(false);
    expect(doc.compiledText).toContain('a@hinh1.com');
  });

  it('reports attached images that the brief never mentions (info only)', async () => {
    const doc = await compilePrompt(mk({ rawBrief: 'vẽ lại @hinh1 theo @hinh2' }));
    const w = doc.warnings.find((x) => x.code === 'UNMENTIONED_REFERENCE');
    expect(w?.severity).toBe('info');
    expect(w?.message).toContain('@hinh3');
    expect(hasBlockingWarning(doc)).toBe(false);
  });
});
