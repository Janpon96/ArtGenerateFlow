import type { PromptDocument, ReferenceBinding, ReferenceRole, TraitConstraint } from '@frs/domain';

export const COMPILER_VERSION = 'prompt-core/1.1.0';

export interface CompileInput {
  rawBrief: string;
  artStyle: string;
  language: PromptDocument['language'];
  exactText: string[];
  constraints: TraitConstraint[];
  /** Already in the order they will be uploaded to the provider (excluding base/guide). */
  references: ReferenceBinding[];
  /** assetId -> byteHash for every asset used. */
  assetHashes: Record<string, string>;
  /** Base image to edit. It always occupies Image 1. `handle`/`alias` let the brief mention it with @handle. */
  base?: { assetId: string; handle?: string; alias?: string } | null;
}

/** Lowercases and strips Vietnamese diacritics so "@Hình1" and "@hinh1" are the same handle. */
export function normalizeHandle(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
}

export const isValidHandle = (h: string): boolean => /^[a-z0-9_]{1,24}$/.test(h);

/** Matches @handle but not the tail of an e-mail address (a@b.com). */
const MENTION_RE = /(?<![\p{L}\p{N}_])@([\p{L}\p{N}_]+)/gu;

export function findMentions(brief: string): string[] {
  const out: string[] = [];
  for (const m of brief.matchAll(MENTION_RE)) out.push(normalizeHandle(m[1]!));
  return out;
}

interface HandleEntry {
  handle: string;
  alias: string;
  /** 1-based "Image N" number, or null when the reference is switched off. */
  index: number | null;
  isBase: boolean;
}

function buildHandleTable(input: CompileInput): HandleEntry[] {
  const table: HandleEntry[] = [];
  let index = 0;
  if (input.base) {
    index++;
    table.push({
      handle: normalizeHandle(input.base.handle ?? 'hinh_goc'),
      alias: input.base.alias ?? 'base',
      index,
      isBase: true,
    });
  }
  input.references.forEach((ref, pos) => {
    const handle = normalizeHandle(ref.handle ?? `hinh${pos + 1}`);
    if (ref.active) index++;
    table.push({ handle, alias: ref.alias, index: ref.active ? index : null, isBase: false });
  });
  return table;
}

function resolveBrief(brief: string, table: HandleEntry[]): string {
  return brief.replace(MENTION_RE, (whole, name: string) => {
    const entry = table.find((e) => e.handle === normalizeHandle(name));
    return entry && entry.index !== null ? `Image ${entry.index} (@${entry.handle})` : whole;
  });
}

const ROLE_TEXT: Record<ReferenceRole, string> = {
  identity: "identity (face, hair, eyes, proportions, recognizable marks)",
  outfit: 'outfit (clothing, accessories, material, color)',
  pose: 'pose (posture, gaze direction, movement)',
  composition: 'composition (framing, camera, placement)',
  environment: 'environment (setting, layout, architecture)',
  style: 'art style (linework, shading, rendering, texture)',
  palette: 'color palette (dominant colors, light/dark relationships)',
  object: 'object (shape, silhouette, material)',
  detail: 'one specific detail chosen by the user',
};

const SUBJECT_ROLES: ReferenceRole[] = ['identity', 'outfit', 'pose'];

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Normalizes newlines only. Never alters words, proper names or exact text. */
const nl = (s: string) => s.replace(/\r\n?/g, '\n').trim();

type Warning = PromptDocument['warnings'][number];

export function lintPrompt(input: CompileInput): Warning[] {
  const warnings: Warning[] = [];
  const active = input.references.filter((r) => r.active);

  for (const ref of active) {
    if (ref.roles.length === 0) {
      warnings.push({ code: 'MISSING_ROLE', severity: 'blocking', message: `Reference "${ref.alias}" has no role.` });
    }
    if (ref.roles.some((r) => SUBJECT_ROLES.includes(r)) && !ref.subjectKey) {
      warnings.push({ code: 'MISSING_SUBJECT', severity: 'blocking', message: `Reference "${ref.alias}" needs a subject.` });
    }
    if (!input.assetHashes[ref.assetId]) {
      warnings.push({ code: 'MISSING_ASSET_HASH', severity: 'blocking', message: `Reference "${ref.alias}" has no byte hash.` });
    }
  }

  // Structured constraints: same subject + attribute with opposing operations or different targets.
  const groups = new Map<string, TraitConstraint[]>();
  for (const c of input.constraints) {
    const key = `${c.subjectKey}\u0000${c.attribute.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  for (const list of groups.values()) {
    const preserve = list.some((c) => c.operation === 'preserve');
    const changes = new Set(list.filter((c) => c.operation === 'change_to').map((c) => c.value));
    if ((preserve && changes.size > 0) || changes.size > 1) {
      const first = list[0]!;
      warnings.push({
        code: 'CONFLICT_TRAIT',
        severity: 'blocking',
        message: `Conflicting instructions for ${first.subjectKey} / ${first.attribute}. Choose keep or change before submitting.`,
      });
    }
  }

  const raw = input.rawBrief.trim();
  if (!raw) warnings.push({ code: 'EMPTY_BRIEF', severity: 'blocking', message: 'The brief is empty.' });

  // @handle mentions
  for (const ref of input.references) {
    if (ref.handle !== undefined && !isValidHandle(normalizeHandle(ref.handle))) {
      warnings.push({
        code: 'INVALID_HANDLE',
        severity: 'blocking',
        message: `Handle "${ref.handle}" of "${ref.alias}" is invalid. Use 1-24 characters: a-z, 0-9, underscore.`,
      });
    }
  }
  const table = buildHandleTable(input);
  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const e of table) {
    if (seen.has(e.handle) && !reported.has(e.handle)) {
      reported.add(e.handle);
      warnings.push({ code: 'DUPLICATE_HANDLE', severity: 'blocking', message: `Handle @${e.handle} is used by more than one image.` });
    }
    seen.add(e.handle);
  }
  const mentions = findMentions(raw);
  const mentioned = new Set(mentions);
  for (const name of [...mentioned]) {
    const entry = table.find((e) => e.handle === name);
    if (!entry) {
      warnings.push({ code: 'UNKNOWN_MENTION', severity: 'blocking', message: `@${name} does not match any uploaded image.` });
    } else if (entry.index === null) {
      warnings.push({ code: 'INACTIVE_MENTION', severity: 'blocking', message: `@${name} points to "${entry.alias}", which is switched off.` });
    }
  }
  if (mentioned.size > 0) {
    for (const e of table) {
      if (e.index !== null && !e.isBase && !mentioned.has(e.handle)) {
        warnings.push({ code: 'UNMENTIONED_REFERENCE', severity: 'info', message: `Image ${e.index} (@${e.handle}, "${e.alias}") is attached but not mentioned in the brief.` });
      }
    }
  }
  return warnings;
}

export async function compilePrompt(input: CompileInput): Promise<PromptDocument> {
  const warnings = lintPrompt(input);
  const active = input.references.filter((r) => r.active);
  const sourceMap: PromptDocument['sourceMap'] = [];
  const lines: string[] = [];
  const table = buildHandleTable(input);

  lines.push('TASK');
  lines.push(input.base ? 'Edit the supplied base image as described below.' : 'Create one image as described below.');
  lines.push('');
  lines.push('REFERENCE MAP: images are supplied in this exact order');

  let index = 0;
  if (input.base) {
    index++;
    sourceMap.push({
      inputIndex: index,
      assetId: input.base.assetId,
      byteHash: input.assetHashes[input.base.assetId] ?? '',
      referenceId: null,
      purpose: 'base',
    });
    const baseTag = input.base.handle ? ` [@${normalizeHandle(input.base.handle)}]` : '';
    lines.push(`Image ${index}${baseTag}: base image to edit. Keep its framing.`);
  }
  for (const ref of active) {
    index++;
    const entry = table.find((e) => e.index === index && !e.isBase);
    sourceMap.push({
      inputIndex: index,
      assetId: ref.assetId,
      byteHash: input.assetHashes[ref.assetId] ?? '',
      referenceId: ref.id,
      purpose: 'reference',
    });
    const roles = ref.roles.map((r) => ROLE_TEXT[r]).join('; ');
    const who = ref.subjectKey ? ` for subject ${ref.subjectKey}` : '';
    const tag = entry ? `@${entry.handle} - ${ref.alias}` : ref.alias;
    let line = `Image ${index} [${tag}]: use only for ${roles}${who}.`;
    if (ref.includeTraits.length) line += ` Preserve: ${ref.includeTraits.join(', ')}.`;
    if (ref.excludeTraits.length) line += ` Do not transfer: ${ref.excludeTraits.join(', ')}.`;
    lines.push(line);
  }

  lines.push('');
  lines.push('SUBJECT AND SCENE');
  lines.push(resolveBrief(nl(input.rawBrief), table));

  if (input.artStyle.trim()) {
    lines.push('');
    lines.push('ART DIRECTION');
    lines.push(nl(input.artStyle));
  }

  const keep = input.constraints.filter((c) => c.operation === 'preserve');
  const change = input.constraints.filter((c) => c.operation === 'change_to');
  const avoid = input.constraints.filter((c) => c.operation === 'avoid');
  if (keep.length || change.length) {
    lines.push('');
    lines.push('MUST KEEP / MUST CHANGE');
    for (const c of keep) lines.push(`Keep ${c.subjectKey} ${c.attribute}: ${c.value}.`);
    for (const c of change) lines.push(`Change ${c.subjectKey} ${c.attribute} to: ${c.value}.`);
  }
  if (input.exactText.length) {
    lines.push('');
    lines.push('EXACT TEXT (reproduce verbatim)');
    for (const t of input.exactText) lines.push(JSON.stringify(t));
  }
  if (avoid.length) {
    lines.push('');
    lines.push('AVOID');
    for (const c of avoid) lines.push(`${c.subjectKey} ${c.attribute}: ${c.value}.`);
  }

  const compiledText = lines.join('\n');
  return {
    rawBrief: input.rawBrief,
    artStyle: input.artStyle,
    language: input.language,
    exactText: input.exactText,
    constraints: input.constraints,
    compiledText,
    compilerVersion: COMPILER_VERSION,
    compiledHash: await sha256Hex(compiledText),
    sourceMap,
    warnings,
  };
}

export const hasBlockingWarning = (doc: PromptDocument): boolean =>
  doc.warnings.some((w) => w.severity === 'blocking');
