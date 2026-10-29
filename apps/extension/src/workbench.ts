import type {
  Asset, PromptDocument, ReferenceBinding, ReferenceRole, TraitConstraint,
} from '@frs/domain';
import { compilePrompt, hasBlockingWarning, normalizeHandle } from '@frs/prompt-core';
import {
  webPngCodec, runStrict, MaskLayer, effectiveMask, clientToPixel,
  probeImage, ImportRejected, LOCAL_LIMITS, findDuplicate, NORMALIZATION_VERSION,
  type PaintMode, type Shape,
} from '@frs/image-core';
import {
  openFrsDb, getAll, put, del, putBlob, getBlob, sha256Bytes,
} from '@frs/storage';
import { base64FromBytes } from '@frs/provider-flow-web';

import { LogBuffer, formatLogLine, type LogLevel } from './log-buffer';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- Console ở đáy trang ----
const logBuf = new LogBuffer(1000);
function log(level: LogLevel, message: string, jobId: string | null = null): void {
  logBuf.add(level, message, jobId);
}

function renderConsole(): void {
  const body = $('console-body');
  const stick = body.scrollTop + body.clientHeight >= body.scrollHeight - 24;
  const minLevel = $<HTMLSelectElement>('log-level').value as 'all' | 'warn' | 'error';
  const jobSel = $<HTMLSelectElement>('log-job');
  const jobId = jobSel.value;
  const ids = logBuf.jobIds();
  if (jobSel.options.length - 1 !== ids.length) {
    jobSel.replaceChildren(new Option('Mọi job', ''));
    for (const id of ids) jobSel.append(new Option(`#${id.slice(0, 8)}`, id));
    jobSel.value = ids.includes(jobId) ? jobId : '';
  }
  const lines = logBuf.filtered({ minLevel, jobId: jobSel.value });
  body.replaceChildren(...lines.map((e) => {
    const d = document.createElement('div');
    d.className = `log-line ${e.level}`;
    d.textContent = formatLogLine(e);
    return d;
  }));
  $('console-count').textContent = String(logBuf.all().length);
  if (stick) body.scrollTop = body.scrollHeight;
}
logBuf.onChange(renderConsole);
$('log-level').addEventListener('change', renderConsole);
$('log-job').addEventListener('change', renderConsole);
$('log-clear').addEventListener('click', () => logBuf.clear());
$('log-copy').addEventListener('click', () => {
  const text = logBuf.all().map(formatLogLine).join('\n');
  void navigator.clipboard.writeText(text).then(() => log('info', 'Đã sao chép log vào clipboard.'));
});
$('log-toggle').addEventListener('click', () => {
  const dock = $('console-dock');
  dock.classList.toggle('collapsed');
  $('log-toggle').textContent = dock.classList.contains('collapsed') ? 'Mở rộng' : 'Thu gọn';
});
$('console-resize').addEventListener('pointerdown', (ev) => {
  const dock = $('console-dock');
  const startY = ev.clientY;
  const startH = dock.getBoundingClientRect().height;
  const move = (e: PointerEvent) => {
    const h = Math.min(window.innerHeight * 0.7, Math.max(80, startH + (startY - e.clientY)));
    dock.style.height = `${h}px`;
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});
window.addEventListener('error', (e) => log('error', `Lỗi không bắt được: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => log('error', `Promise bị từ chối: ${String(e.reason)}`));
log('info', 'Workbench đã khởi động.');

function selectedModel(): string {
  const v = $<HTMLSelectElement>('model').value;
  return (v === '__custom__' ? $<HTMLInputElement>('model-custom').value : v).trim();
}
$('model').addEventListener('change', () => {
  $('model-custom').hidden = $<HTMLSelectElement>('model').value !== '__custom__';
});

const ALL_ROLES: Array<{ role: ReferenceRole; label: string }> = [
  { role: 'identity', label: 'Khuôn mặt / Nhân dạng' },
  { role: 'outfit', label: 'Trang phục' },
  { role: 'pose', label: 'Tư thế / Dáng' },
  { role: 'composition', label: 'Bố cục' },
  { role: 'environment', label: 'Bối cảnh' },
  { role: 'style', label: 'Phong cách vẽ' },
  { role: 'palette', label: 'Bảng màu' },
  { role: 'object', label: 'Vật thể' },
  { role: 'detail', label: 'Chi tiết riêng' },
];

const dbPromise = openFrsDb();


interface RefItem {
  asset: Asset;
  binding: ReferenceBinding;
  bytes: Uint8Array;
  objectUrl: string;
}

let refs: RefItem[] = [];
let baseAssetId: string | null = null;
const constraints: TraitConstraint[] = [];
let lastDoc: PromptDocument | null = null;

// ---- Điều hướng Tab ----
document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab!;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === target));
  });
});

function switchTab(tabId: string): void {
  const btn = document.querySelector<HTMLButtonElement>(`.tab-btn[data-tab="${tabId}"]`);
  btn?.click();
}

function showRefStatus(msg: string, kind: 'ok' | 'warn' | 'bad' = 'ok'): void {
  const box = $('ref-status');
  if (!msg) {
    box.replaceChildren();
    return;
  }
  const div = document.createElement('div');
  div.className = `alert ${kind}`;
  div.textContent = msg;
  box.replaceChildren(div);
}

// ---- 1. Quản lý Nhiều Ảnh Tham Chiếu (Multi-Reference) ----
async function restoreRefsFromDb(): Promise<void> {
  const db = await dbPromise;
  const savedAssets = await getAll<Asset>(db, 'assets');
  const savedBindings = await getAll<ReferenceBinding>(db, 'references');
  const assetMap = new Map(savedAssets.map((a) => [a.id, a]));
  const loaded: RefItem[] = [];

  for (const b of savedBindings) {
    const asset = assetMap.get(b.assetId);
    if (!asset) continue;
    const blobRec = await getBlob(db, asset.originalBlobKey);
    if (!blobRec) continue;
    const url = URL.createObjectURL(new Blob([blobRec.bytes as BlobPart], { type: asset.mimeType }));
    loaded.push({ asset, binding: b, bytes: blobRec.bytes, objectUrl: url });
  }
  refs = loaded;
  for (const r of refs) {
    if (!r.binding.handle) {
      r.binding.handle = nextHandle();
      void saveBinding(r.binding);
    }
  }
  renderRefs();
  refreshStrictRefSelect();
}

/** Smallest unused default handle: hinh1, hinh2, ... (stable once assigned). */
function nextHandle(): string {
  const used = new Set(refs.map((r) => normalizeHandle(r.binding.handle ?? '')));
  let n = 1;
  while (used.has(`hinh${n}`)) n++;
  return `hinh${n}`;
}

/** Inserts @handle at the cursor of the brief textarea. */
function insertMention(handle: string): void {
  const ta = $<HTMLTextAreaElement>('brief');
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const before = ta.value.slice(0, start);
  const needSpace = before.length > 0 && !/\s$/.test(before);
  const text = `${needSpace ? ' ' : ''}@${handle} `;
  ta.value = before + text + ta.value.slice(end);
  const pos = start + text.length;
  ta.focus();
  ta.setSelectionRange(pos, pos);
  void autoCompileIfReady();
}

function renderMentionChips(): void {
  const box = $('mention-chips');
  box.replaceChildren();
  if (refs.length === 0) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const label = document.createElement('span');
  label.className = 'card-sub';
  label.textContent = 'Bấm để chèn vào mô tả:';
  box.append(label);
  const active = refs.filter((r) => r.binding.active);
  for (const item of refs) {
    const isBase = baseAssetId === item.asset.id;
    const pos = isBase ? 1 : active.filter((r) => r.asset.id !== baseAssetId).indexOf(item) + 1 + (baseAssetId ? 1 : 0);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'sm mention-chip';
    chip.disabled = !item.binding.active;
    chip.title = item.binding.active ? `${item.binding.alias} → Image ${pos}` : 'Ảnh đang tắt';
    chip.textContent = `@${item.binding.handle ?? ''}${item.binding.active ? ` = Image ${pos}` : ' (tắt)'}`;
    chip.addEventListener('click', () => insertMention(item.binding.handle ?? ''));
    box.append(chip);
  }
}

async function addReferenceFiles(fileList: FileList | File[]): Promise<void> {
  const files = Array.from(fileList);
  if (!files.length) return;
  const db = await dbPromise;
  const knownHashes = new Map<string, string>(refs.map((r) => [r.asset.originalByteHash, r.binding.alias]));
  const notes: string[] = [];
  let added = 0;

  for (const file of files) {
    if (refs.length >= LOCAL_LIMITS.maxReferences) {
      notes.push(`Đã chạm giới hạn tối đa ${LOCAL_LIMITS.maxReferences} ảnh tham chiếu.`);
      break;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const probe = probeImage(bytes, LOCAL_LIMITS);
      const byteHash = await sha256Bytes(bytes);
      const dupAlias = findDuplicate(byteHash, knownHashes);
      if (dupAlias) {
        notes.push(`Bỏ qua "${file.name}" vì trùng hoàn toàn byte với ảnh "${dupAlias}".`);
        continue;
      }

      const id = crypto.randomUUID();
      const blobKey = `blob_${id.replaceAll('-', '')}`;
      await putBlob(db, blobKey, probe.mimeType, bytes);

      const asset: Asset = {
        id,
        projectId: 'local',
        source: 'user_upload',
        originalBlobKey: blobKey,
        originalByteHash: byteHash,
        normalizedBlobKey: blobKey,
        normalizedPixelHash: byteHash,
        width: probe.width,
        height: probe.height,
        mimeType: probe.mimeType,
        colorSpace: 'srgb',
        pixelFormat: 'rgba8-straight',
        normalizationVersion: NORMALIZATION_VERSION,
        parentAssetId: null,
      };

      const cleanName = file.name.replace(/\.[^.]+$/, '').slice(0, 28) || `ref_${refs.length + 1}`;
      const binding: ReferenceBinding = {
        id: `ref_${id}`,
        assetId: id,
        alias: cleanName,
        handle: nextHandle(),
        roles: ['style'],
        subjectKey: 'main_subject',
        priority: refs.length === 0 ? 'primary' : 'secondary',
        includeTraits: [],
        excludeTraits: [],
        active: true,
      };

      await put(db, 'assets', asset);
      await put(db, 'references', binding);
      const objectUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: probe.mimeType }));
      refs.push({ asset, binding, bytes, objectUrl });
      knownHashes.set(byteHash, binding.alias);
      added++;
    } catch (e) {
      if (e instanceof ImportRejected) {
        notes.push(`Từ chối "${file.name}": [${e.code}] ${e.message}`);
      } else {
        notes.push(`Lỗi khi đọc "${file.name}": ${String(e)}`);
      }
    }
  }

  renderRefs();
  refreshStrictRefSelect();
  if (notes.length) {
    showRefStatus(notes.join(' • '), added > 0 ? 'warn' : 'bad');
  } else if (added > 0) {
    showRefStatus(`Đã thêm ${added} ảnh tham chiếu hợp lệ.`, 'ok');
  }
  await autoCompileIfReady();
}

async function saveBinding(b: ReferenceBinding): Promise<void> {
  await put(await dbPromise, 'references', b);
}

async function removeRef(index: number): Promise<void> {
  const item = refs[index];
  if (!item) return;
  URL.revokeObjectURL(item.objectUrl);
  const db = await dbPromise;
  await del(db, 'references', item.binding.id);
  await del(db, 'assets', item.asset.id);
  if (baseAssetId === item.asset.id) baseAssetId = null;
  refs.splice(index, 1);
  renderRefs();
  refreshStrictRefSelect();
  await autoCompileIfReady();
}

function moveRef(index: number, delta: number): void {
  const target = index + delta;
  if (target < 0 || target >= refs.length) return;
  const tmp = refs[index]!;
  refs[index] = refs[target]!;
  refs[target] = tmp;
  renderRefs();
  void autoCompileIfReady();
}

function renderRefs(): void {
  $('ref-count-badge').textContent = `${refs.length} / ${LOCAL_LIMITS.maxReferences}`;
  const container = $('ref-list');
  container.replaceChildren();

  if (refs.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'card-sub';
    empty.textContent = 'Chưa có ảnh tham chiếu nào. Bạn có thể tải lên nhiều ảnh nhân vật, trang phục, bối cảnh hoặc bảng màu để kết hợp.';
    container.append(empty);
    return;
  }

  refs.forEach((item, idx) => {
    const { asset, binding } = item;
    const isBase = baseAssetId === asset.id;
    const card = document.createElement('div');
    card.className = `ref-card${binding.active ? '' : ' inactive'}${isBase ? ' is-base' : ''}`;

    // Thumbnail column
    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'ref-thumb-wrap';
    const img = document.createElement('img');
    img.className = 'ref-thumb';
    img.src = item.objectUrl;
    img.alt = binding.alias;

    const meta = document.createElement('div');
    meta.className = 'ref-meta';
    meta.textContent = `${asset.width}×${asset.height} • ${asset.mimeType.replace('image/', '').toUpperCase()}`;

    const orderRow = document.createElement('div');
    orderRow.style.cssText = 'display:flex; gap:4px; justify-content:center;';
    const upBtn = document.createElement('button');
    upBtn.className = 'sm';
    upBtn.textContent = '↑';
    upBtn.title = 'Đẩy lên trước';
    upBtn.disabled = idx === 0;
    upBtn.addEventListener('click', () => moveRef(idx, -1));

    const downBtn = document.createElement('button');
    downBtn.className = 'sm';
    downBtn.textContent = '↓';
    downBtn.title = 'Đẩy xuống sau';
    downBtn.disabled = idx === refs.length - 1;
    downBtn.addEventListener('click', () => moveRef(idx, 1));

    orderRow.append(upBtn, downBtn);
    thumbWrap.append(img, meta, orderRow);

    // Controls column
    const body = document.createElement('div');
    const top = document.createElement('div');
    top.className = 'ref-top';

    const leftTop = document.createElement('div');
    leftTop.style.cssText = 'display:flex; align-items:center; gap:8px; flex:1;';

    const orderBadge = document.createElement('span');
    orderBadge.className = `badge${isBase ? ' ok' : ''}`;
    orderBadge.textContent = isBase ? 'ẢNH GỐC (BASE)' : `Ref #${idx + 1}`;

    const aliasInput = document.createElement('input');
    aliasInput.type = 'text';
    aliasInput.value = binding.alias;
    aliasInput.placeholder = 'Tên gợi nhớ (alias)';
    aliasInput.style.maxWidth = '180px';
    aliasInput.addEventListener('change', () => {
      binding.alias = aliasInput.value.trim() || `ref_${idx + 1}`;
      void saveBinding(binding);
      refreshStrictRefSelect();
      void autoCompileIfReady();
    });

    const handleWrap = document.createElement('span');
    handleWrap.style.cssText = 'display:flex; align-items:center; gap:2px;';
    const at = document.createElement('span');
    at.textContent = '@';
    const handleInput = document.createElement('input');
    handleInput.type = 'text';
    handleInput.value = binding.handle ?? '';
    handleInput.placeholder = 'định danh';
    handleInput.maxLength = 24;
    handleInput.title = 'Định danh để gọi ảnh này trong mô tả, VD: @' + (binding.handle ?? 'hinh1');
    handleInput.style.maxWidth = '110px';
    handleInput.addEventListener('change', () => {
      const h = normalizeHandle(handleInput.value.trim().replace(/^@/, '')).replace(/\s+/g, '_');
      if (!/^[a-z0-9_]{1,24}$/.test(h)) {
        showRefStatus('Định danh chỉ gồm a-z, 0-9, gạch dưới (tối đa 24 ký tự).', 'bad');
        handleInput.value = binding.handle ?? '';
        return;
      }
      if (refs.some((r) => r !== item && normalizeHandle(r.binding.handle ?? '') === h)) {
        showRefStatus(`Định danh @${h} đã được ảnh khác dùng.`, 'bad');
        handleInput.value = binding.handle ?? '';
        return;
      }
      binding.handle = h;
      void saveBinding(binding);
      renderRefs();
      void autoCompileIfReady();
    });
    handleWrap.append(at, handleInput);

    leftTop.append(orderBadge, handleWrap, aliasInput);

    const rightTop = document.createElement('div');
    rightTop.style.cssText = 'display:flex; align-items:center; gap:6px; flex-wrap:wrap;';

    const baseBtn = document.createElement('button');
    baseBtn.className = 'sm';
    baseBtn.textContent = isBase ? 'Bỏ làm Ảnh gốc' : 'Đặt làm Ảnh gốc';
    baseBtn.addEventListener('click', () => {
      baseAssetId = isBase ? null : asset.id;
      renderRefs();
      void autoCompileIfReady();
    });

    {
      const strictBtn = document.createElement('button');
      strictBtn.className = 'sm';
      strictBtn.textContent = 'Sửa vùng Strict';
      strictBtn.addEventListener('click', () => {
        void loadBytesIntoStrictBase(item.bytes, binding.alias);
        switchTab('tab-strict');
      });
      rightTop.append(strictBtn);
    }

    const activeBtn = document.createElement('button');
    activeBtn.className = 'sm';
    activeBtn.textContent = binding.active ? 'Đang bật' : 'Đang tắt';
    activeBtn.addEventListener('click', () => {
      binding.active = !binding.active;
      void saveBinding(binding);
      renderRefs();
      void autoCompileIfReady();
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'sm danger';
    delBtn.textContent = 'Xóa';
    delBtn.addEventListener('click', () => void removeRef(idx));

    rightTop.prepend(baseBtn, activeBtn);
    rightTop.append(delBtn);
    top.append(leftTop, rightTop);

    // Role chips
    const roleWrap = document.createElement('div');
    roleWrap.className = 'role-chips';
    ALL_ROLES.forEach(({ role, label }) => {
      const chip = document.createElement('span');
      const selected = binding.roles.includes(role);
      chip.className = `role-chip${selected ? ' selected' : ''}`;
      chip.textContent = label;
      chip.addEventListener('click', () => {
        if (binding.roles.includes(role)) {
          binding.roles = binding.roles.filter((r) => r !== role);
        } else {
          binding.roles = [...binding.roles, role];
        }
        void saveBinding(binding);
        renderRefs();
        void autoCompileIfReady();
      });
      roleWrap.append(chip);
    });

    // Subject & traits row
    const detailRow = document.createElement('div');
    detailRow.className = 'field-row-3';
    detailRow.style.marginBottom = '0';

    const subjInput = document.createElement('input');
    subjInput.type = 'text';
    subjInput.value = binding.subjectKey ?? '';
    subjInput.placeholder = 'Chủ thể (VD: hero_a)';
    subjInput.addEventListener('change', () => {
      binding.subjectKey = subjInput.value.trim() || null;
      void saveBinding(binding);
      void autoCompileIfReady();
    });

    const incInput = document.createElement('input');
    incInput.type = 'text';
    incInput.value = binding.includeTraits.join(', ');
    incInput.placeholder = 'Giữ lại (cách dấu phẩy)';
    incInput.addEventListener('change', () => {
      binding.includeTraits = incInput.value.split(',').map((s) => s.trim()).filter(Boolean);
      void saveBinding(binding);
      void autoCompileIfReady();
    });

    const excInput = document.createElement('input');
    excInput.type = 'text';
    excInput.value = binding.excludeTraits.join(', ');
    excInput.placeholder = 'Không lấy (cách dấu phẩy)';
    excInput.addEventListener('change', () => {
      binding.excludeTraits = excInput.value.split(',').map((s) => s.trim()).filter(Boolean);
      void saveBinding(binding);
      void autoCompileIfReady();
    });

    detailRow.append(subjInput, incInput, excInput);
    body.append(top, roleWrap, detailRow);
    card.append(thumbWrap, body);
    container.append(card);
  });
  renderMentionChips();
}

// Dropzone & file input events
const refInput = $<HTMLInputElement>('ref-input');
const dropzone = $('ref-dropzone');
refInput.addEventListener('change', () => {
  if (refInput.files) void addReferenceFiles(refInput.files);
  refInput.value = '';
});
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer?.files) void addReferenceFiles(e.dataTransfer.files);
});

$('clear-refs').addEventListener('click', async () => {
  while (refs.length > 0) await removeRef(0);
  showRefStatus('Đã xóa toàn bộ ảnh tham chiếu.', 'warn');
});

// ---- Ràng buộc Thuộc tính (TraitConstraints) ----
function renderConstraints(): void {
  const box = $('constraint-list');
  box.replaceChildren();
  constraints.forEach((c, idx) => {
    const row = document.createElement('div');
    row.className = 'constraint-item';
    const opLabel = c.operation === 'preserve' ? 'GIỮ NGUYÊN' : c.operation === 'change_to' ? 'ĐỔI THÀNH' : 'TRÁNH';
    const span = document.createElement('span');
    span.textContent = `[${opLabel}] ${c.subjectKey} • ${c.attribute}: ${c.value}`;
    const delBtn = document.createElement('button');
    delBtn.className = 'sm danger';
    delBtn.textContent = 'Xóa';
    delBtn.addEventListener('click', () => {
      constraints.splice(idx, 1);
      renderConstraints();
      void autoCompileIfReady();
    });
    row.append(span, delBtn);
    box.append(row);
  });
}

$('add-constraint').addEventListener('click', () => {
  const subjectKey = $<HTMLInputElement>('c-subject').value.trim() || 'main_subject';
  const attribute = $<HTMLInputElement>('c-attr').value.trim();
  const operation = $<HTMLSelectElement>('c-op').value as TraitConstraint['operation'];
  const value = $<HTMLInputElement>('c-val').value.trim();
  if (!attribute || !value) return;
  constraints.push({ subjectKey, attribute, value, operation, sourceRefId: null });
  $<HTMLInputElement>('c-attr').value = '';
  $<HTMLInputElement>('c-val').value = '';
  renderConstraints();
  void autoCompileIfReady();
});

// ---- Biên dịch Prompt ----
async function runCompile(): Promise<PromptDocument> {
  const assetHashes: Record<string, string> = {};
  for (const r of refs) assetHashes[r.asset.id] = r.asset.originalByteHash;

  const nonBaseRefs = refs
    .filter((r) => r.asset.id !== baseAssetId)
    .map((r) => r.binding);
  const baseItem = refs.find((r) => r.asset.id === baseAssetId);

  const exactText = $<HTMLInputElement>('exact-text').value
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

  const doc = await compilePrompt({
    rawBrief: $<HTMLTextAreaElement>('brief').value,
    artStyle: $<HTMLInputElement>('style').value,
    language: 'vi',
    exactText,
    constraints,
    references: nonBaseRefs,
    assetHashes,
    base: baseAssetId
      ? { assetId: baseAssetId, handle: baseItem?.binding.handle, alias: baseItem?.binding.alias }
      : null,
  });

  lastDoc = doc;
  $('compiled').textContent = `${doc.compiledText}\n\n// SHA-256: ${doc.compiledHash}`;

  const warnBox = $('compile-warnings');
  warnBox.replaceChildren();
  for (const w of doc.warnings) {
    const d = document.createElement('div');
    d.className = `alert ${w.severity === 'blocking' ? 'bad' : 'warn'}`;
    d.textContent = `[${w.code}] ${w.message}`;
    warnBox.append(d);
  }

  // Render Source Map
  const mapBox = $('source-map-box');
  const mapList = $('source-map-list');
  mapList.replaceChildren();
  if (doc.sourceMap.length > 0) {
    mapBox.hidden = false;
    for (const entry of doc.sourceMap) {
      const refItem = refs.find((r) => r.asset.id === entry.assetId);
      const row = document.createElement('div');
      row.className = 'source-map-item';
      if (refItem) {
        const thumb = document.createElement('img');
        thumb.src = refItem.objectUrl;
        row.append(thumb);
      }
      const txt = document.createElement('span');
      const label = entry.purpose === 'base'
        ? 'Ảnh gốc (Base Image)'
        : `Ref "${refItem?.binding.alias ?? entry.assetId.slice(0, 6)}"`;
      txt.textContent = `Image ${entry.inputIndex} → ${label} (hash: ${entry.byteHash.slice(0, 10)}…)`;
      row.append(txt);
      mapList.append(row);
    }
  } else {
    mapBox.hidden = true;
  }

  return doc;
}

async function autoCompileIfReady(): Promise<void> {
  if ($<HTMLTextAreaElement>('brief').value.trim()) {
    await runCompile();
  }
}

$('compile').addEventListener('click', () => void runCompile());

$('copy-prompt').addEventListener('click', async () => {
  const doc = lastDoc ?? (await runCompile());
  await navigator.clipboard.writeText(doc.compiledText);
  say('Đã sao chép Prompt vào clipboard!');
});

$('load-sample').addEventListener('click', async () => {
  $<HTMLTextAreaElement>('brief').value =
    'Nhân vật chính đứng dưới hiên quán cà phê Sài Gòn buổi tối mưa nhẹ, ánh đèn neon phản chiếu trên mặt đường ướt, góc máy trung cảnh ngang tầm mắt.';
  $<HTMLInputElement>('style').value = 'Cinematic anime keyframe, high-contrast rim light, detailed rain reflections';
  $<HTMLInputElement>('exact-text').value = 'CAFE SAIGON';
  if (constraints.length === 0) {
    constraints.push(
      { subjectKey: 'main_subject', attribute: 'khuôn mặt & kiểu tóc', value: 'giữ đúng tỷ lệ và đường nét từ ảnh tham chiếu', operation: 'preserve', sourceRefId: null },
      { subjectKey: 'main_subject', attribute: 'trang phục', value: 'áo khoác trench coat màu xanh đậm', operation: 'change_to', sourceRefId: null },
    );
    renderConstraints();
  }
  await runCompile();
});

// ---- 2. Sửa vùng Strict (PNG + MaskLayer 2 lớp + Lasso/Rect + Feather) ----
interface Loaded { width: number; height: number; rgba: Uint8Array }
let baseImg: Loaded | null = null;
let candImg: Loaded | null = null;
let allowLayer: MaskLayer | null = null;
let protectLayer: MaskLayer | null = null;
let dragPoints: Array<{ x: number; y: number }> = [];
let resultUrl: string | null = null;
let lastResultBytes: Uint8Array | null = null;

const viewCanvas = $<HTMLCanvasElement>('view');
const resultCanvas = $<HTMLCanvasElement>('resultPreview');

function refreshStrictRefSelect(): void {
  const sel = $<HTMLSelectElement>('pick-ref-as-base');
  sel.replaceChildren();
  const def = document.createElement('option');
  def.value = '';
  def.textContent = '-- Chọn ảnh từ danh sách Reference --';
  sel.append(def);
  for (const r of refs) {
    const opt = document.createElement('option');
    opt.value = r.asset.id;
    opt.textContent = `${r.binding.alias} (${r.asset.width}×${r.asset.height})`;
    sel.append(opt);
  }
}

async function decodeAnyImage(bytes: Uint8Array): Promise<Loaded> {
  if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) {
    try {
      return await webPngCodec.decode(bytes);
    } catch {
      // Fallback nếu PNG không đúng colour type của webPngCodec
    }
  }

  const blob = new Blob([bytes as BlobPart]);
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob);
      const cvs = document.createElement('canvas');
      cvs.width = bmp.width;
      cvs.height = bmp.height;
      const ctx = cvs.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const imgData = ctx.getImageData(0, 0, bmp.width, bmp.height);
      bmp.close();
      return { width: cvs.width, height: cvs.height, rgba: new Uint8Array(imgData.data.buffer) };
    } catch {
      // Fallback sang HTMLImageElement
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const cvs = document.createElement('canvas');
      cvs.width = img.naturalWidth;
      cvs.height = img.naturalHeight;
      const ctx = cvs.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, cvs.width, cvs.height);
      resolve({ width: cvs.width, height: cvs.height, rgba: new Uint8Array(imgData.data.buffer) });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Không thể giải mã định dạng ảnh này.'));
    };
    img.src = url;
  });
}

const decodePngBytes = decodeAnyImage;

function clearStrictResult(): void {
  candImg = null;
  lastResultBytes = null;
  if (resultUrl) {
    URL.revokeObjectURL(resultUrl);
    resultUrl = null;
  }
  const dl = $<HTMLAnchorElement>('download');
  dl.hidden = true;
  $('send-result-to-ref').hidden = true;
  const useResBtn = document.getElementById('use-result-as-base');
  if (useResBtn) useResBtn.hidden = true;

  resultCanvas.width = 640;
  resultCanvas.height = 400;
  const ctx = resultCanvas.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, 640, 400);

  const candInput = $<HTMLInputElement>('cand');
  if (candInput) candInput.value = '';
  setEditStatus('');
}

async function loadBytesIntoStrictBase(bytes: Uint8Array, label: string): Promise<void> {
  try {
    baseImg = await decodeAnyImage(bytes);
    allowLayer = new MaskLayer(baseImg.width, baseImg.height);
    protectLayer = new MaskLayer(baseImg.width, baseImg.height);
    dragPoints = [];
    clearStrictResult();
    drawStrictCanvas();
    setStrictReport(`Đã nạp ảnh gốc "${label}" (${baseImg.width}×${baseImg.height}). Kéo chuột trên ảnh để vẽ vùng sửa.`, 'ok');
  } catch (e) {
    setStrictReport(`Không đọc được ảnh: ${String(e instanceof Error ? e.message : e)}`, 'bad');
  }
}

function setStrictReport(text: string, kind: 'ok' | 'warn' | 'bad' = 'ok'): void {
  const box = $('report');
  box.replaceChildren();
  if (!text) return;
  const div = document.createElement('div');
  div.className = `alert ${kind}`;
  div.style.whiteSpace = 'pre-wrap';
  div.textContent = text;
  box.append(div);
}

function drawStrictCanvas(): void {
  if (!baseImg || !allowLayer || !protectLayer) return;
  viewCanvas.width = baseImg.width;
  viewCanvas.height = baseImg.height;
  const ctx = viewCanvas.getContext('2d')!;
  const overlay = new Uint8ClampedArray(baseImg.rgba);
  const allow = allowLayer.data;
  const prot = protectLayer.data;

  for (let i = 0; i < allow.length; i++) {
    const o = i * 4;
    if (prot[i] === 1) {
      // Xanh lá cho vùng bảo vệ tuyệt đối
      overlay[o] = Math.round(overlay[o]! * 0.45 + 16 * 0.55);
      overlay[o + 1] = Math.round(overlay[o + 1]! * 0.45 + 220 * 0.55);
      overlay[o + 2] = Math.round(overlay[o + 2]! * 0.45 + 110 * 0.55);
    } else if (allow[i] === 1) {
      // Đỏ hồng cho vùng cho phép sửa
      overlay[o] = Math.round(overlay[o]! * 0.45 + 245 * 0.55);
      overlay[o + 1] = Math.round(overlay[o + 1]! * 0.45 + 60 * 0.55);
      overlay[o + 2] = Math.round(overlay[o + 2]! * 0.45 + 95 * 0.55);
    }
  }
  ctx.putImageData(new ImageData(overlay, baseImg.width, baseImg.height), 0, 0);

  // Vẽ nét đang kéo chuột
  if (dragPoints.length >= 2) {
    const shapeKind = $<HTMLSelectElement>('mask-shape').value;
    const targetKind = $<HTMLSelectElement>('mask-target').value;
    ctx.strokeStyle = targetKind === 'protect' ? '#10b981' : '#f43f5e';
    ctx.lineWidth = Math.max(1.5, baseImg.width / 320);
    if (shapeKind === 'brush') {
      ctx.lineWidth = brushRadius() * 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(dragPoints[0]!.x, dragPoints[0]!.y);
      for (let i = 1; i < dragPoints.length; i++) ctx.lineTo(dragPoints[i]!.x, dragPoints[i]!.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (shapeKind === 'rect') {
      const a = dragPoints[0]!;
      const b = dragPoints[dragPoints.length - 1]!;
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    } else {
      ctx.beginPath();
      ctx.moveTo(dragPoints[0]!.x, dragPoints[0]!.y);
      for (let i = 1; i < dragPoints.length; i++) ctx.lineTo(dragPoints[i]!.x, dragPoints[i]!.y);
      ctx.closePath();
      ctx.stroke();
    }
  }
}

$('base').addEventListener('change', async () => {
  const input = $<HTMLInputElement>('base');
  const f = input.files?.[0];
  if (!f) return;
  await loadBytesIntoStrictBase(new Uint8Array(await f.arrayBuffer()), f.name);
  input.value = '';
});

$('cand').addEventListener('change', async () => {
  const input = $<HTMLInputElement>('cand');
  const f = input.files?.[0];
  if (!f) return;
  try {
    candImg = await decodeAnyImage(new Uint8Array(await f.arrayBuffer()));
    setStrictReport(`Đã nạp ảnh ứng viên "${f.name}" (${candImg.width}×${candImg.height}). Bấm "Chạy Ghép & Kiểm định Strict".`, 'ok');
  } catch (e) {
    setStrictReport(`Không đọc được ảnh ứng viên: ${String(e instanceof Error ? e.message : e)}`, 'bad');
  }
  input.value = '';
});

$('use-ref-base').addEventListener('click', async () => {
  const id = $<HTMLSelectElement>('pick-ref-as-base').value;
  const found = refs.find((r) => r.asset.id === id);
  if (!found) {
    setStrictReport('Hãy chọn một ảnh PNG trong danh sách Reference.', 'warn');
    return;
  }
  await loadBytesIntoStrictBase(found.bytes, found.binding.alias);
});

$('make-demo-cand').addEventListener('click', () => {
  if (!baseImg) {
    setStrictReport('Hãy nạp Ảnh gốc (Base PNG) trước, sau đó bấm nút này để tạo ảnh ứng viên thử nghiệm.', 'warn');
    return;
  }
  // Tạo một ảnh ứng viên có hiệu ứng đổi màu rực rỡ toàn khung để kiểm chứng Strict cắt đúng vùng mask
  const rgba = new Uint8Array(baseImg.rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = Math.min(255, Math.round(baseImg.rgba[i]! * 0.5 + 110));
    rgba[i + 1] = Math.min(255, Math.round(baseImg.rgba[i + 1]! * 0.85));
    rgba[i + 2] = Math.min(255, Math.round(255 - baseImg.rgba[i + 2]! * 0.5));
    rgba[i + 3] = baseImg.rgba[i + 3]!;
  }
  candImg = { width: baseImg.width, height: baseImg.height, rgba };
  setStrictReport('Đã tạo ảnh ứng viên Demo cùng kích thước. Bấm "Chạy Ghép & Kiểm định Strict" để xem kết quả!', 'ok');
});

function canvasPoint(ev: PointerEvent) {
  const r = viewCanvas.getBoundingClientRect();
  return clientToPixel({
    clientX: ev.clientX,
    clientY: ev.clientY,
    canvasRect: r,
    zoom: r.width / viewCanvas.width,
    pan: { x: 0, y: 0 },
    image: { width: viewCanvas.width, height: viewCanvas.height },
  });
}

viewCanvas.addEventListener('pointerdown', (ev) => {
  if (!baseImg) return;
  viewCanvas.setPointerCapture(ev.pointerId);
  const p = canvasPoint(ev);
  dragPoints = [{ x: p.fx, y: p.fy }];
});

viewCanvas.addEventListener('pointermove', (ev) => {
  if (!dragPoints.length || !(ev.buttons & 1)) return;
  const p = canvasPoint(ev);
  const shapeKind = $<HTMLSelectElement>('mask-shape').value;
  if (shapeKind === 'rect') {
    dragPoints = [dragPoints[0]!, { x: p.fx, y: p.fy }];
  } else {
    dragPoints.push({ x: p.fx, y: p.fy });
  }
  drawStrictCanvas();
});

viewCanvas.addEventListener('pointerup', () => {
  const minPts = $<HTMLSelectElement>('mask-shape').value === 'brush' ? 1 : 2;
  if (dragPoints.length < minPts || !allowLayer || !protectLayer) {
    dragPoints = [];
    return;
  }
  const shapeKind = $<HTMLSelectElement>('mask-shape').value;
  const target = $<HTMLSelectElement>('mask-target').value;
  const mode = $<HTMLSelectElement>('mask-mode').value as PaintMode;
  const layer = target === 'protect' ? protectLayer : allowLayer;

  const shape: Shape = shapeKind === 'brush'
    ? { kind: 'brush', points: dragPoints, radius: brushRadius() }
    : shapeKind === 'rect'
    ? { kind: 'rect', x0: dragPoints[0]!.x, y0: dragPoints[0]!.y, x1: dragPoints[dragPoints.length - 1]!.x, y1: dragPoints[dragPoints.length - 1]!.y }
    : { kind: 'lasso', points: dragPoints };

  layer.apply(shape, mode);
  dragPoints = [];
  drawStrictCanvas();
});

$('mask-undo').addEventListener('click', () => {
  const target = $<HTMLSelectElement>('mask-target').value;
  const layer = target === 'protect' ? protectLayer : allowLayer;
  layer?.undo();
  drawStrictCanvas();
});

$('mask-redo').addEventListener('click', () => {
  const target = $<HTMLSelectElement>('mask-target').value;
  const layer = target === 'protect' ? protectLayer : allowLayer;
  layer?.redo();
  drawStrictCanvas();
});

$('mask-clear').addEventListener('click', () => {
  allowLayer?.clear();
  protectLayer?.clear();
  drawStrictCanvas();
});

const featherInput = $<HTMLInputElement>('feather');
featherInput.addEventListener('input', () => {
  $('feather-val').textContent = featherInput.value;
});

$('run').addEventListener('click', async () => {
  if (!baseImg || !candImg || !allowLayer || !protectLayer) {
    setStrictReport('Cần nạp Ảnh gốc, Ảnh ứng viên (hoặc bấm nút Tạo ảnh ứng viên Demo) và vẽ vùng chọn.', 'warn');
    return;
  }
  if (baseImg.width !== candImg.width || baseImg.height !== candImg.height) {
    setStrictReport('Ảnh ứng viên khác kích thước ảnh gốc. Strict từ chối co giãn ảnh gốc để bảo toàn từng pixel.', 'bad');
    return;
  }
  const eff = effectiveMask(allowLayer.data, protectLayer.data, baseImg.width, baseImg.height);
  const featherRadius = Number(featherInput.value) || 0;
  const res = await runStrict({
    width: baseImg.width,
    height: baseImg.height,
    base: baseImg.rgba,
    candidate: candImg.rgba,
    mask: eff,
    featherRadius,
    codec: webPngCodec,
  });

  const r = res.report;
  setStrictReport(
    [
      `Trạng thái: ${r.passed ? 'ĐẠT CHUẨN STRICT (100% pixel ngoài vùng giữ nguyên tuyệt đối)' : 'KHÔNG ĐẠT'} • Nhãn: ${res.label}`,
      `Tổng pixel ngoài vùng sửa: ${r.outsidePixelCount.toLocaleString()} • Số pixel bị lệch: ${r.outsideChangedPixels}`,
      `SHA-256 PNG xuất ra: ${r.outputFileHash}`,
      `Codec kiểm định: ${r.encoderVersion}`,
    ].join('\n'),
    r.passed ? 'ok' : 'bad',
  );

  // Vẽ kết quả lên canvas preview
  const decoded = await webPngCodec.decode(res.fileBytes);
  resultCanvas.width = decoded.width;
  resultCanvas.height = decoded.height;
  resultCanvas.getContext('2d')!.putImageData(
    new ImageData(new Uint8ClampedArray(decoded.rgba), decoded.width, decoded.height),
    0,
    0,
  );

  const dl = $<HTMLAnchorElement>('download');
  const sendBtn = $('send-result-to-ref');
  const useResBtn = document.getElementById('use-result-as-base');
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  if (r.passed) {
    lastResultBytes = res.fileBytes;
    resultUrl = URL.createObjectURL(new Blob([res.fileBytes as BlobPart], { type: 'image/png' }));
    dl.href = resultUrl;
    dl.hidden = false;
    sendBtn.hidden = false;
    if (useResBtn) useResBtn.hidden = false;
  } else {
    dl.hidden = true;
    sendBtn.hidden = true;
    if (useResBtn) useResBtn.hidden = true;
  }
});

$('send-result-to-ref').addEventListener('click', async () => {
  if (!lastResultBytes) return;
  const file = new File([lastResultBytes as BlobPart], `strict_edit_${Date.now()}.png`, { type: 'image/png' });
  await addReferenceFiles([file]);
  switchTab('tab-studio');
});

$('use-result-as-base')?.addEventListener('click', async () => {
  if (!lastResultBytes) return;
  await loadBytesIntoStrictBase(lastResultBytes, 'Kết quả vừa sửa');
  setStrictReport('Đã dùng kết quả vừa sửa làm Ảnh gốc mới. Bạn có thể bôi vùng mới để tiếp tục chỉnh sửa!', 'ok');
});

// ---- Bridge client: Workbench -> Python bridge_server -> Google Flow ----
const API_URL = 'http://127.0.0.1:8200';
const JOBS_KEY = 'frs.bridge.jobs';
const FINAL_STATES = new Set(['done', 'error']);
const STATE_LABEL: Record<string, string> = {
  queued: 'Đang xếp hàng', preparing: 'Chuẩn bị', uploading: 'Tải ảnh tham chiếu',
  generating: 'Đang tạo ảnh', done: 'Hoàn tất', error: 'Lỗi',
};

interface BridgeStep { at?: string; level?: string; msg: string }
interface BridgeImage { index: number; url: string }
interface BridgeJob {
  id: string; state: string; prompt?: string; model?: string; aspect_ratio?: string; count?: number;
  error?: string | null; steps: BridgeStep[]; images: BridgeImage[];
}

function say(msg: string): void {
  $('jobmsg').textContent = msg;
}

let bridgeJobs: BridgeJob[] = [];
const pollers = new Map<string, number>();
const loggedSteps = new Map<string, number>();

function saveJobs(): void {
  try { localStorage.setItem(JOBS_KEY, JSON.stringify(bridgeJobs.slice(0, 50))); } catch { /* quota */ }
}

async function bridgeFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_URL}${path}`, init);
  } catch (e) {
    throw new Error(
      'Không kết nối được bridge server (127.0.0.1:8200). Hãy chạy run.bat hoặc python bridge_server.py.',
      { cause: e },
    );
  }
}

async function fetchModels(): Promise<void> {
  const sel = $<HTMLSelectElement>('model');
  try {
    const res = await bridgeFetch('/models');
    const data = (await res.json()) as { models: Array<{ id: string; name: string }> };
    const prev = sel.value;
    sel.replaceChildren(
      ...data.models.map((m) => new Option(m.name, m.id)),
      new Option('Khác (nhập id model)...', '__custom__'),
    );
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
    log('info', `Đã tải ${data.models.length} model từ bridge server.`);
  } catch (e) {
    sel.replaceChildren(new Option('(chưa kết nối bridge server)', ''), new Option('Khác (nhập id model)...', '__custom__'));
    log('warn', e instanceof Error ? e.message : String(e));
  }
}

function logNewSteps(job: BridgeJob): void {
  const seen = loggedSteps.get(job.id) ?? 0;
  for (const s of job.steps.slice(seen)) {
    log(s.level === 'error' ? 'error' : s.level === 'warn' ? 'warn' : 'info', s.msg, job.id);
  }
  loggedSteps.set(job.id, job.steps.length);
}

function upsertJob(job: BridgeJob): void {
  const i = bridgeJobs.findIndex((j) => j.id === job.id);
  if (i >= 0) bridgeJobs[i] = { ...bridgeJobs[i], ...job };
  else bridgeJobs.unshift(job);
  logNewSteps(job);
  saveJobs();
  renderBridgeJobs();
}

function startPolling(id: string): void {
  if (pollers.has(id)) return;
  const tick = async (): Promise<void> => {
    try {
      const res = await bridgeFetch(`/jobs/${id}`);
      if (res.status === 404) { stopPolling(id); return; }
      const job = (await res.json()) as BridgeJob;
      upsertJob(job);
      if (FINAL_STATES.has(job.state)) { stopPolling(id); return; }
    } catch (e) {
      log('warn', e instanceof Error ? e.message : String(e), id);
    }
    pollers.set(id, window.setTimeout(() => void tick(), 1500));
  };
  pollers.set(id, window.setTimeout(() => void tick(), 0));
}

function stopPolling(id: string): void {
  const t = pollers.get(id);
  if (t !== undefined) window.clearTimeout(t);
  pollers.delete(id);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

async function useImageAsRef(img: BridgeImage, jobId: string): Promise<void> {
  try {
    const res = await bridgeFetch(img.url);
    const blob = await res.blob();
    const file = new File([blob], `flow_${jobId.slice(0, 8)}_${img.index + 1}.jpg`, { type: blob.type || 'image/jpeg' });
    await addReferenceFiles([file]);
    switchTab('tab-studio');
  } catch (e) {
    log('error', e instanceof Error ? e.message : String(e), jobId);
  }
}

function renderBridgeJobs(): void {
  $('job-count').textContent = String(bridgeJobs.length);
  const box = $('jobs');
  if (bridgeJobs.length === 0) {
    box.replaceChildren(el('p', 'card-sub', 'Chưa có job nào. Bấm "Tạo Job Generate / Edit" ở Tab 1.'));
    return;
  }
  box.replaceChildren(...bridgeJobs.map((job) => {
    const card = el('div', 'job-card');
    const head = el('div');
    head.append(
      el('b', undefined, `#${job.id.slice(0, 8)} `),
      el('span', undefined, `${STATE_LABEL[job.state] ?? job.state} • ${job.model ?? ''} • ${job.aspect_ratio ?? ''} • ${job.count ?? ''} ảnh`),
    );
    card.append(head);
    if (job.prompt) card.append(el('p', 'card-sub', job.prompt.length > 200 ? `${job.prompt.slice(0, 200)}…` : job.prompt));
    if (job.error) card.append(el('p', 'card-sub', `Lỗi: ${job.error}`));
    const ol = el('ol');
    for (const s of job.steps) ol.append(el('li', undefined, s.msg));
    card.append(ol);
    if (job.images?.length) {
      const gallery = el('div', 'gallery');
      for (const im of job.images) {
        const fig = el('figure');
        const img = el('img');
        img.src = `${API_URL}${im.url}`;
        img.alt = `Ảnh ${im.index + 1}`;
        img.addEventListener('click', () => window.open(img.src, '_blank'));
        const cap = el('figcaption');
        const dl = el('a', undefined, 'Tải về');
        dl.href = `${API_URL}${im.url}?download=true`;
        dl.download = `flow_${job.id.slice(0, 8)}_${im.index + 1}.jpg`;
        const useRef = el('button', undefined, 'Dùng làm ref');
        useRef.addEventListener('click', () => void useImageAsRef(im, job.id));
        cap.append(dl, useRef);
        fig.append(img, cap);
        gallery.append(fig);
      }
      card.append(gallery);
    }
    return card;
  }));
}

function readSize(): { width: number; height: number } {
  const v = $<HTMLSelectElement>('size').value;
  let w: number;
  let h: number;
  if (v === '__custom__') {
    w = Number($<HTMLInputElement>('size-w').value);
    h = Number($<HTMLInputElement>('size-h').value);
  } else {
    [w, h] = v.split('x').map(Number) as [number, number];
  }
  const ok = (n: number) => Number.isFinite(n) && n >= 64 && n <= 8192;
  return ok(w) && ok(h) ? { width: Math.round(w), height: Math.round(h) } : { width: 0, height: 0 };
}
$('size').addEventListener('change', () => {
  $('size-custom').hidden = $<HTMLSelectElement>('size').value !== '__custom__';
});

$('newjob').addEventListener('click', async () => {
  try {
    const doc = await runCompile();
    if (hasBlockingWarning(doc)) { say('Còn cảnh báo chặn (màu đỏ). Hãy sửa trước khi tạo job.'); return; }
    if (!doc.compiledText.trim()) { say('Prompt đang trống.'); return; }
    const model = selectedModel();
    if (!model) { say('Hãy chọn model.'); return; }
    const references = refs
      .filter((r) => r.binding.active && r.asset.id !== baseAssetId)
      .map((r) => ({ name: r.binding.handle, mime: r.asset.mimeType, base64: base64FromBytes(r.bytes) }));
    const body = {
      prompt: doc.compiledText,
      model,
      aspect_ratio: $<HTMLSelectElement>('ratio').value,
      count: Number($<HTMLSelectElement>('out-count').value) || 1,
      ...readSize(),
      references,
    };
    say('Đang gửi job tới bridge server...');
    const res = await bridgeFetch('/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Bridge từ chối job (HTTP ${res.status}): ${await res.text()}`);
    const job = (await res.json()) as BridgeJob;
    upsertJob(job);
    startPolling(job.id);
    say(`Đã tạo job #${job.id.slice(0, 8)}. Xem tiến độ ở Tab 3 và Console.`);
    switchTab('tab-jobs');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    say(msg);
    log('error', msg);
  }
});

// ---- Sửa / Xóa vùng đã tô qua Flow ----
function brushRadius(): number {
  return Math.max(1, Number($<HTMLInputElement>('brush-size').value) / 2);
}
$('brush-size').addEventListener('input', () => {
  $('brush-val').textContent = $<HTMLInputElement>('brush-size').value;
});

function syncEditModels(): void {
  const src = $<HTMLSelectElement>('model');
  const dst = $<HTMLSelectElement>('edit-model');
  const prev = dst.value;
  dst.replaceChildren(...[...src.options].filter((o) => o.value && o.value !== '__custom__').map((o) => new Option(o.text, o.value)));
  if ([...dst.options].some((o) => o.value === prev)) dst.value = prev;
}

function canvasToPngBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Không mã hóa được PNG'))), 'image/png'));
}

async function blobToBase64(b: Blob): Promise<string> {
  return base64FromBytes(new Uint8Array(await b.arrayBuffer()));
}

function setEditStatus(text: string): void {
  $('edit-status').replaceChildren(document.createTextNode(text));
}

async function useEditResult(job: BridgeJob, im: BridgeImage): Promise<void> {
  const res = await bridgeFetch(im.url);
  if (!res.ok) throw new Error(`Không tải được ảnh kết quả (HTTP ${res.status})`);
  candImg = await decodePngBytes(new Uint8Array(await res.arrayBuffer()));
  setStrictReport(`Đã nhận ảnh ${im.index + 1} từ Flow (job #${job.id.slice(0, 8)}). Đang ghép vào vùng đã tô...`, 'ok');
  $('run').click();
}

async function waitJob(id: string): Promise<BridgeJob> {
  for (;;) {
    const res = await bridgeFetch(`/jobs/${id}`);
    if (!res.ok) throw new Error(`Không đọc được job (HTTP ${res.status})`);
    const job = (await res.json()) as BridgeJob;
    upsertJob(job);
    if (FINAL_STATES.has(job.state)) return job;
    setEditStatus(`${STATE_LABEL[job.state] ?? job.state}... (xem chi tiết ở Tab 3)`);
    await new Promise((r) => window.setTimeout(r, 1500));
  }
}

$('edit-generate').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('edit-generate');
  try {
    if (!baseImg || !allowLayer || !protectLayer) { setEditStatus('Hãy nạp Ảnh gốc PNG trước.'); return; }
    const mode = $<HTMLSelectElement>('edit-mode').value;
    const prompt = $<HTMLTextAreaElement>('edit-prompt').value.trim();
    if (mode === 'edit' && !prompt) { setEditStatus('Hãy nhập prompt mô tả cần sửa.'); return; }
    const model = $<HTMLSelectElement>('edit-model').value;
    if (!model) { setEditStatus('Chưa có model (bridge server chưa kết nối?).'); return; }
    const mask = effectiveMask(allowLayer.data, protectLayer.data, baseImg.width, baseImg.height);
    if (!mask.some((v) => v === 1)) { setEditStatus('Chưa tô vùng nào. Dùng Cọ tô để bôi vùng cần sửa.'); return; }

    btn.disabled = true;
    setEditStatus('Đang chuẩn bị ảnh và mask...');
    const w = baseImg.width;
    const h = baseImg.height;
    const baseC = document.createElement('canvas');
    baseC.width = w; baseC.height = h;
    baseC.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(baseImg.rgba), w, h), 0, 0);
    const maskC = document.createElement('canvas');
    maskC.width = w; maskC.height = h;
    const md = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < mask.length; i++) {
      const v = mask[i] === 1 ? 255 : 0;
      md[i * 4] = v; md[i * 4 + 1] = v; md[i * 4 + 2] = v; md[i * 4 + 3] = 255;
    }
    maskC.getContext('2d')!.putImageData(new ImageData(md, w, h), 0, 0);

    const body = {
      prompt, mode, model,
      count: Number($<HTMLSelectElement>('edit-count').value) || 1,
      base: { name: 'base.png', mime: 'image/png', base64: await blobToBase64(await canvasToPngBlob(baseC)) },
      mask: { name: 'mask.png', mime: 'image/png', base64: await blobToBase64(await canvasToPngBlob(maskC)) },
    };
    setEditStatus('Đang gửi tới bridge server...');
    const res = await bridgeFetch('/edits', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Bridge từ chối (HTTP ${res.status}): ${await res.text()}`);
    const created = (await res.json()) as BridgeJob;
    upsertJob(created);
    const job = await waitJob(created.id);
    if (job.state === 'error' || !job.images?.length) {
      throw new Error(job.error ?? 'Flow không trả ảnh nào.');
    }
    const box = $('edit-status');
    box.replaceChildren(document.createTextNode(`Xong ${job.images.length} ảnh. Chọn ảnh để ghép: `));
    for (const im of job.images) {
      const b = document.createElement('button');
      b.className = 'sm';
      b.textContent = `Ảnh ${im.index + 1}`;
      b.addEventListener('click', () => void useEditResult(job, im).catch((e) => setEditStatus(String(e instanceof Error ? e.message : e))));
      box.append(b);
    }
    await useEditResult(job, job.images[0]!);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setEditStatus(msg);
    log('error', msg);
  } finally {
    btn.disabled = false;
  }
});

async function initBridge(): Promise<void> {
  try {
    bridgeJobs = JSON.parse(localStorage.getItem(JOBS_KEY) ?? '[]') as BridgeJob[];
  } catch { bridgeJobs = []; }
  for (const j of bridgeJobs) loggedSteps.set(j.id, j.steps?.length ?? 0);
  renderBridgeJobs();
  await restoreRefsFromDb();
  await fetchModels();
  syncEditModels();
  for (const j of bridgeJobs) if (!FINAL_STATES.has(j.state)) startPolling(j.id);
}
void initBridge();
