import { initAssetTab } from './asset-tab';
import { initRoomTab } from './room-tab';
import { initCameraTab } from './camera-tab';
import { initAnimTab } from './anim-tab';
import { initVideoTab } from './video-tab';
import { mountAllCreditBars } from './credits';
import { openLightbox, showToast } from './ui-helpers';
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
  openFrsDb, getAll, put, del, putBlob, getBlob, sha256Bytes, exportBackup, importBackup,
} from '@frs/storage';
import { base64FromBytes } from '@frs/provider-flow-web';

import { LogBuffer, formatLogLine, type LogLevel } from './log-buffer';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- Console ở đáy trang (thu gọn thông minh, hiện dòng mới nhất trực tiếp trên thanh trạng thái) ----
const CONSOLE_OPEN_KEY = 'frs.console.open';
const logBuf = new LogBuffer(1000);
function log(level: LogLevel, message: string, jobId: string | null = null): void {
  logBuf.add(level, message, jobId);
}

function setConsoleCollapsed(collapsed: boolean): void {
  const dock = $('console-dock');
  dock.classList.toggle('collapsed', collapsed);
  document.body.classList.toggle('console-expanded', !collapsed);
  $('log-toggle').textContent = collapsed ? 'Mở rộng ▴' : 'Thu gọn ▾';
  try {
    localStorage.setItem(CONSOLE_OPEN_KEY, collapsed ? '0' : '1');
  } catch {
    /* ignore */
  }
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
  const allEntries = logBuf.all();
  const lines = logBuf.filtered({ minLevel, jobId: jobSel.value });
  body.replaceChildren(...lines.map((e) => {
    const d = document.createElement('div');
    d.className = `log-line ${e.level}`;
    d.textContent = formatLogLine(e);
    return d;
  }));
  $('console-count').textContent = String(allEntries.length);

  const latestEl = document.getElementById('console-latest');
  const lastEntry = allEntries[allEntries.length - 1];
  if (latestEl && lastEntry) {
    latestEl.textContent = formatLogLine(lastEntry);
    latestEl.style.color = lastEntry.level === 'error'
      ? '#fca5a5'
      : lastEntry.level === 'warn'
        ? '#fcd34d'
        : 'var(--text-muted)';
  }

  if (stick) body.scrollTop = body.scrollHeight;
}

logBuf.onChange(renderConsole);
$('log-level').addEventListener('change', renderConsole);
$('log-job').addEventListener('change', renderConsole);
$('log-clear').addEventListener('click', () => logBuf.clear());
$('log-copy').addEventListener('click', () => {
  const text = logBuf.all().map(formatLogLine).join('\n');
  void navigator.clipboard.writeText(text).then(() => {
    log('info', 'Đã sao chép log vào clipboard.');
    showToast('Đã sao chép toàn bộ log Console!', 'ok', 2000);
  });
});

const toggleConsole = (): void => {
  const dock = $('console-dock');
  setConsoleCollapsed(!dock.classList.contains('collapsed'));
};
$('log-toggle').addEventListener('click', toggleConsole);
document.getElementById('console-title-toggle')?.addEventListener('click', toggleConsole);
document.getElementById('console-latest')?.addEventListener('click', toggleConsole);

try {
  const savedOpen = localStorage.getItem(CONSOLE_OPEN_KEY) === '1';
  setConsoleCollapsed(!savedOpen);
} catch {
  setConsoleCollapsed(true);
}

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
log('info', 'Workbench đã khởi động sẵn sàng.');

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

// ---- Backup Export & Import ----
$('backup').addEventListener('click', async () => {
  try {
    const db = await dbPromise;
    const backup = await exportBackup(db, new Date().toISOString());
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `frs-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Đã xuất tệp Backup JSON thành công!', 'ok');
    log('info', 'Đã xuất dữ liệu Backup JSON.');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showToast(`Xuất Backup thất bại: ${msg}`, 'error');
    log('error', `Xuất Backup lỗi: ${msg}`);
  }
});

document.getElementById('import-backup-btn')?.addEventListener('click', () => {
  $<HTMLInputElement>('import-backup-file').click();
});

document.getElementById('import-backup-file')?.addEventListener('change', async (ev) => {
  const input = ev.currentTarget as HTMLInputElement;
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  try {
    const raw = JSON.parse(await f.text()) as unknown;
    const db = await dbPromise;
    const res = await importBackup(db, raw);
    await restoreRefsFromDb();
    showToast(`Đã khôi phục ${res.records} bản ghi & ${res.blobs} ảnh từ Backup!`, 'ok');
    log('info', `Khôi phục Backup thành công (${res.records} bản ghi, ${res.blobs} blobs).`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showToast(`Nhập Backup từ chối: ${msg}`, 'error', 5000);
    log('error', `Nhập Backup thất bại: ${msg}`);
  }
});

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

// ---- Điều hướng Tab & Hash URL ----
const IMAGE_TABS = ['tab-studio', 'tab-strict', 'tab-asset', 'tab-room', 'tab-camera'];
const ALL_TABS = [...IMAGE_TABS, 'tab-anim', 'tab-video', 'tab-jobs', 'tab-guide'];
const IMAGE_SUB_KEY = 'frs.imageSub';
let activeTabId = 'tab-studio';

function activateTab(target: string): void {
  if (!ALL_TABS.includes(target)) return;
  activeTabId = target;
  const isImage = IMAGE_TABS.includes(target);
  document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((b) => {
    const on = b.dataset.group === 'image' ? isImage : b.dataset.tab === target;
    b.classList.toggle('active', on);
  });
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === target));
  $('image-subnav').classList.toggle('show', isImage);
  document.querySelectorAll<HTMLButtonElement>('.sub-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === target));
  if (target !== 'tab-strict') {
    const cursor = document.getElementById('brush-cursor');
    if (cursor) cursor.style.display = 'none';
  }
  if (isImage) {
    try {
      localStorage.setItem(IMAGE_SUB_KEY, target);
    } catch {
      /* localStorage không khả dụng: bỏ qua */
    }
  }
}

document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    let target = btn.dataset.tab!;
    if (btn.dataset.group === 'image') {
      let saved: string | null;
      try {
        saved = localStorage.getItem(IMAGE_SUB_KEY);
      } catch {
        saved = null;
      }
      if (saved && IMAGE_TABS.includes(saved)) target = saved;
    }
    activateTab(target);
  });
});

document.querySelectorAll<HTMLButtonElement>('.sub-btn').forEach((btn) => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab!));
});

function switchTab(tabId: string): void {
  activateTab(tabId);
}

// Khôi phục tab từ URL hash (ví dụ mở từ Sidepanel #tab-asset)
function applyUrlHash(): void {
  const h = window.location.hash.replace(/^#/, '');
  if (ALL_TABS.includes(h)) activateTab(h);
}
window.addEventListener('hashchange', applyUrlHash);
applyUrlHash();

// Phím tắt toàn cục: Ctrl+Enter chạy Generate của tab đang mở; Alt+1..5 chuyển tab chính
const TAB_GENERATE_BTN: Record<string, string> = {
  'tab-studio': 'newjob',
  'tab-strict': 'edit-generate',
  'tab-asset': 'asset-generate',
  'tab-room': 'room-generate',
  'tab-camera': 'cam-generate',
  'tab-anim': 'anim-generate',
  'tab-video': 'vid-generate',
};

window.addEventListener('keydown', (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
    const btnId = TAB_GENERATE_BTN[activeTabId];
    const btn = btnId ? (document.getElementById(btnId) as HTMLButtonElement | null) : null;
    if (btn && !btn.disabled) {
      ev.preventDefault();
      btn.click();
    }
    return;
  }
  if (ev.altKey && !ev.ctrlKey && !ev.metaKey) {
    const map: Record<string, () => void> = {
      '1': () => $('top-image').click(),
      '2': () => activateTab('tab-anim'),
      '3': () => activateTab('tab-video'),
      '4': () => activateTab('tab-jobs'),
      '5': () => activateTab('tab-guide'),
    };
    const fn = map[ev.key];
    if (fn) {
      ev.preventDefault();
      fn();
    }
  }
});

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

function nextHandle(): string {
  const used = new Set(refs.map((r) => normalizeHandle(r.binding.handle ?? '')));
  let n = 1;
  while (used.has(`hinh${n}`)) n++;
  return `hinh${n}`;
}

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
  label.style.margin = '0';
  label.textContent = 'Chèn nhanh:';
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
    chip.textContent = `@${item.binding.handle ?? ''}${item.binding.active ? ` → Image ${pos}` : ' (tắt)'}`;
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
        roles: [],
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
    showToast(`Đã thêm ${added} ảnh tham chiếu!`, 'ok', 2200);
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
    renderMentionChips();
    const empty = document.createElement('p');
    empty.className = 'card-sub';
    empty.textContent = 'Chưa có ảnh tham chiếu nào. Tải lên hoặc Ctrl+V dán ảnh nhân vật, trang phục, bối cảnh để bắt đầu phối.';
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
    img.title = 'Bấm để xem phóng lớn Lightbox';
    img.addEventListener('click', () => {
      openLightbox({
        src: item.objectUrl,
        title: `@${binding.handle ?? ''} • ${binding.alias}`,
        subtitle: `${asset.width}×${asset.height} • ${asset.mimeType.replace('image/', '').toUpperCase()}`,
        downloadName: `${binding.alias}.png`,
      });
    });

    const meta = document.createElement('div');
    meta.className = 'ref-meta';
    meta.textContent = `${asset.width}×${asset.height} • ${asset.mimeType.replace('image/', '').toUpperCase()}`;

    const orderRow = document.createElement('div');
    orderRow.style.cssText = 'display:flex; gap:4px; justify-content:center;';
    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'sm';
    upBtn.textContent = '↑';
    upBtn.title = 'Đẩy lên trước';
    upBtn.disabled = idx === 0;
    upBtn.addEventListener('click', () => moveRef(idx, -1));

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
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
    leftTop.style.cssText = 'display:flex; align-items:center; gap:7px; flex:1; flex-wrap:wrap;';

    const orderBadge = document.createElement('span');
    orderBadge.className = `badge${isBase ? ' ok' : ''}`;
    orderBadge.textContent = isBase ? '★ ẢNH GỐC' : `Ref #${idx + 1}`;

    const handleWrap = document.createElement('span');
    handleWrap.className = 'handle-pill-group';
    const at = document.createElement('span');
    at.textContent = '@';
    const handleInput = document.createElement('input');
    handleInput.type = 'text';
    handleInput.value = binding.handle ?? '';
    handleInput.placeholder = 'định danh';
    handleInput.maxLength = 24;
    handleInput.title = 'Định danh gọi trong mô tả, VD: @' + (binding.handle ?? 'hinh1');
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

    const aliasInput = document.createElement('input');
    aliasInput.type = 'text';
    aliasInput.value = binding.alias;
    aliasInput.placeholder = 'Tên gợi nhớ';
    aliasInput.style.cssText = 'max-width:155px; padding:4px 8px; font-size:12px;';
    aliasInput.addEventListener('change', () => {
      binding.alias = aliasInput.value.trim() || `ref_${idx + 1}`;
      void saveBinding(binding);
      refreshStrictRefSelect();
      void autoCompileIfReady();
    });

    leftTop.append(orderBadge, handleWrap, aliasInput);

    const rightTop = document.createElement('div');
    rightTop.style.cssText = 'display:flex; align-items:center; gap:5px; flex-wrap:wrap;';

    const baseBtn = document.createElement('button');
    baseBtn.type = 'button';
    baseBtn.className = `sm${isBase ? ' active' : ''}`;
    baseBtn.textContent = isBase ? '★ Bỏ gốc' : 'Đặt làm gốc';
    baseBtn.title = 'Đặt ảnh này làm Ảnh gốc (Image 1) để chỉnh sửa dựa trên bố cục của nó';
    baseBtn.addEventListener('click', () => {
      baseAssetId = isBase ? null : asset.id;
      renderRefs();
      void autoCompileIfReady();
    });

    const strictBtn = document.createElement('button');
    strictBtn.type = 'button';
    strictBtn.className = 'sm';
    strictBtn.textContent = 'Sửa vùng';
    strictBtn.addEventListener('click', () => {
      void loadBytesIntoStrictBase(item.bytes, binding.alias);
      switchTab('tab-strict');
    });

    const activeBtn = document.createElement('button');
    activeBtn.type = 'button';
    activeBtn.className = `sm${binding.active ? ' active' : ''}`;
    activeBtn.textContent = binding.active ? 'Bật' : 'Tắt';
    activeBtn.addEventListener('click', () => {
      binding.active = !binding.active;
      void saveBinding(binding);
      renderRefs();
      void autoCompileIfReady();
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'sm danger';
    delBtn.textContent = '✕';
    delBtn.title = 'Xóa ảnh này';
    delBtn.addEventListener('click', () => void removeRef(idx));

    rightTop.append(baseBtn, strictBtn, activeBtn, delBtn);
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
    subjInput.style.cssText = 'padding:5px 8px; font-size:12px;';
    subjInput.addEventListener('change', () => {
      binding.subjectKey = subjInput.value.trim() || null;
      void saveBinding(binding);
      void autoCompileIfReady();
    });

    const incInput = document.createElement('input');
    incInput.type = 'text';
    incInput.value = binding.includeTraits.join(', ');
    incInput.placeholder = 'Giữ lại (cách dấu phẩy)';
    incInput.style.cssText = 'padding:5px 8px; font-size:12px;';
    incInput.addEventListener('change', () => {
      binding.includeTraits = incInput.value.split(',').map((s) => s.trim()).filter(Boolean);
      void saveBinding(binding);
      void autoCompileIfReady();
    });

    const excInput = document.createElement('input');
    excInput.type = 'text';
    excInput.value = binding.excludeTraits.join(', ');
    excInput.placeholder = 'Không lấy (cách dấu phẩy)';
    excInput.style.cssText = 'padding:5px 8px; font-size:12px;';
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

// Dropzone, file input & Ctrl+V Clipboard Paste
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

window.addEventListener('paste', (ev) => {
  const items = Array.from(ev.clipboardData?.items ?? []);
  const imgFiles = items
    .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
    .map((it) => it.getAsFile())
    .filter((f): f is File => f !== null);
  if (!imgFiles.length) return;

  if (activeTabId === 'tab-studio') {
    ev.preventDefault();
    void addReferenceFiles(imgFiles);
  } else if (activeTabId === 'tab-strict') {
    ev.preventDefault();
    const f = imgFiles[0]!;
    void f.arrayBuffer().then((buf) => loadBytesIntoStrictBase(new Uint8Array(buf), f.name || 'Ảnh dán từ Clipboard'));
  }
});

$('clear-refs').addEventListener('click', async () => {
  if (!refs.length) return;
  while (refs.length > 0) await removeRef(0);
  showRefStatus('Đã xóa toàn bộ ảnh tham chiếu.', 'warn');
  showToast('Đã xóa toàn bộ ảnh tham chiếu.', 'info', 2000);
});

// Style presets nhanh cho Tab 1
document.querySelectorAll<HTMLButtonElement>('#studio-style-presets .preset-chip[data-style]').forEach((chip) => {
  chip.addEventListener('click', () => {
    $<HTMLInputElement>('style').value = chip.dataset.style || '';
    document.querySelectorAll('#studio-style-presets .preset-chip').forEach((c) => c.classList.toggle('active', c === chip));
    void autoCompileIfReady();
  });
});

// Quick count pills (1 / 2 / 4) đồng bộ với #out-count và cập nhật Token HUD tức thì
function syncCountPills(): void {
  const val = String(Math.max(1, Number($<HTMLInputElement>('out-count').value) || 1));
  document.querySelectorAll<HTMLButtonElement>('#quick-count-pills .preset-chip[data-count]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.count === val);
  });
}
document.querySelectorAll<HTMLButtonElement>('#quick-count-pills .preset-chip[data-count]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const outInput = $<HTMLInputElement>('out-count');
    outInput.value = btn.dataset.count || '1';
    syncCountPills();
    outInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
});
$('out-count').addEventListener('input', syncCountPills);

// Đồng bộ thông minh giữa Tỉ lệ khung (#ratio) và Kích thước xuất (#size)
$('size').addEventListener('change', () => {
  const sz = $<HTMLSelectElement>('size').value;
  $('size-custom').hidden = sz !== '__custom__';
  const ratioSel = $<HTMLSelectElement>('ratio');
  if (sz === '1920x1080' || sz === '3840x2160') ratioSel.value = '16:9';
  else if (sz === '1080x1920') ratioSel.value = '9:16';
  else if (sz === '1080x1080') ratioSel.value = '1:1';
});
$('ratio').addEventListener('change', () => {
  const r = $<HTMLSelectElement>('ratio').value;
  const szSel = $<HTMLSelectElement>('size');
  const standard = new Set(['1920x1080', '1080x1920', '1080x1080']);
  if (!standard.has(szSel.value)) return;
  if (r === '16:9') szSel.value = '1920x1080';
  else if (r === '9:16') szSel.value = '1080x1920';
  else if (r === '1:1') szSel.value = '1080x1080';
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
    delBtn.type = 'button';
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
  if (!attribute || !value) {
    showToast('Hãy nhập đủ Thuộc tính và Giá trị chi tiết.', 'warn');
    return;
  }
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

$('compile').addEventListener('click', () => void runCompile().then(() => showToast('Đã biên dịch Prompt!', 'info', 1600)));

$('copy-prompt').addEventListener('click', async () => {
  const doc = lastDoc ?? (await runCompile());
  await navigator.clipboard.writeText(doc.compiledText);
  say('Đã sao chép Prompt vào clipboard!');
  showToast('Đã sao chép Prompt vào clipboard!', 'ok', 2000);
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
  showToast('Đã nạp kịch bản mẫu thử!', 'ok', 2000);
});

// ---- 2. Sửa vùng Strict (PNG + MaskLayer 2 lớp + Lasso/Rect + Feather + Segmented Toolbar + Brush Cursor) ----
interface Loaded { width: number; height: number; rgba: Uint8Array }
let baseImg: Loaded | null = null;
let candImg: Loaded | null = null;
let allowLayer: MaskLayer | null = null;
let protectLayer: MaskLayer | null = null;
let dragPoints: Array<{ x: number; y: number }> = [];
let resultUrl: string | null = null;
let lastResultBytes: Uint8Array | null = null;
let lastDecodedResult: Loaded | null = null;

const viewCanvas = $<HTMLCanvasElement>('view');
const resultCanvas = $<HTMLCanvasElement>('resultPreview');

// Đồng bộ Segmented Toolbar 1-click với các <select> ẩn
document.querySelectorAll<HTMLElement>('.seg-group[data-sync]').forEach((group) => {
  const selectId = group.dataset.sync!;
  const sel = document.getElementById(selectId) as HTMLSelectElement | null;
  if (!sel) return;
  group.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      sel.value = btn.dataset.val || '';
      group.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
});

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
  lastDecodedResult = null;
  if (resultUrl) {
    URL.revokeObjectURL(resultUrl);
    resultUrl = null;
  }
  $<HTMLAnchorElement>('download').hidden = true;
  $('send-result-to-ref').hidden = true;
  const useResBtn = document.getElementById('use-result-as-base');
  if (useResBtn) useResBtn.hidden = true;
  const cmpBtn = document.getElementById('compare-strict-orig');
  if (cmpBtn) cmpBtn.hidden = true;

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
    const emptyHint = document.getElementById('strict-empty-hint');
    if (emptyHint) emptyHint.hidden = true;
    clearStrictResult();
    drawStrictCanvas();
    setStrictReport(`Đã nạp ảnh gốc "${label}" (${baseImg.width}×${baseImg.height}). Kéo chuột trên ảnh để tô vùng sửa.`, 'ok');
    showToast(`Đã nạp ảnh gốc: ${label}`, 'ok', 2200);
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    setStrictReport(`Không đọc được ảnh: ${msg}`, 'bad');
    showToast(`Không đọc được ảnh: ${msg}`, 'error');
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
      overlay[o] = Math.round(overlay[o]! * 0.45 + 16 * 0.55);
      overlay[o + 1] = Math.round(overlay[o + 1]! * 0.45 + 220 * 0.55);
      overlay[o + 2] = Math.round(overlay[o + 2]! * 0.45 + 110 * 0.55);
    } else if (allow[i] === 1) {
      overlay[o] = Math.round(overlay[o]! * 0.45 + 245 * 0.55);
      overlay[o + 1] = Math.round(overlay[o + 1]! * 0.45 + 60 * 0.55);
      overlay[o + 2] = Math.round(overlay[o + 2]! * 0.45 + 95 * 0.55);
    }
  }
  ctx.putImageData(new ImageData(overlay, baseImg.width, baseImg.height), 0, 0);

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

// Kéo thả ảnh trực tiếp vào khung vẽ #strict-stage
const strictStage = document.getElementById('strict-stage');
strictStage?.addEventListener('dragover', (e) => {
  e.preventDefault();
  strictStage.classList.add('dragover');
});
strictStage?.addEventListener('dragleave', () => strictStage.classList.remove('dragover'));
strictStage?.addEventListener('drop', (e) => {
  e.preventDefault();
  strictStage.classList.remove('dragover');
  const f = e.dataTransfer?.files?.[0];
  if (f && f.type.startsWith('image/')) {
    void f.arrayBuffer().then((buf) => loadBytesIntoStrictBase(new Uint8Array(buf), f.name));
  }
});

$('cand').addEventListener('change', async () => {
  const input = $<HTMLInputElement>('cand');
  const f = input.files?.[0];
  if (!f) return;
  try {
    candImg = await decodeAnyImage(new Uint8Array(await f.arrayBuffer()));
    setStrictReport(`Đã nạp ảnh ứng viên "${f.name}" (${candImg.width}×${candImg.height}). Bấm "Chạy Ghép & Kiểm định".`, 'ok');
  } catch (e) {
    setStrictReport(`Không đọc được ảnh ứng viên: ${String(e instanceof Error ? e.message : e)}`, 'bad');
  }
  input.value = '';
});

$('use-ref-base').addEventListener('click', async () => {
  const id = $<HTMLSelectElement>('pick-ref-as-base').value;
  const found = refs.find((r) => r.asset.id === id);
  if (!found) {
    setStrictReport('Hãy chọn một ảnh trong danh sách Reference.', 'warn');
    showToast('Hãy chọn 1 ảnh trong danh sách Reference.', 'warn');
    return;
  }
  await loadBytesIntoStrictBase(found.bytes, found.binding.alias);
});

$('make-demo-cand').addEventListener('click', () => {
  if (!baseImg) {
    setStrictReport('Hãy nạp Ảnh gốc trước, sau đó bấm nút này để tạo ảnh ứng viên thử nghiệm.', 'warn');
    return;
  }
  const rgba = new Uint8Array(baseImg.rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = Math.min(255, Math.round(baseImg.rgba[i]! * 0.5 + 110));
    rgba[i + 1] = Math.min(255, Math.round(baseImg.rgba[i + 1]! * 0.85));
    rgba[i + 2] = Math.min(255, Math.round(255 - baseImg.rgba[i + 2]! * 0.5));
    rgba[i + 3] = baseImg.rgba[i + 3]!;
  }
  candImg = { width: baseImg.width, height: baseImg.height, rgba };
  setStrictReport('Đã tạo ảnh ứng viên Demo cùng kích thước. Bấm "Chạy Ghép & Kiểm định" để xem kết quả!', 'ok');
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

// Vòng tròn hiển thị cỡ cọ trực tiếp dưới con trỏ chuột
const brushCursor = document.getElementById('brush-cursor');
function updateBrushCursor(ev: PointerEvent): void {
  if (!brushCursor) return;
  const shapeKind = $<HTMLSelectElement>('mask-shape').value;
  if (!baseImg || shapeKind !== 'brush' || activeTabId !== 'tab-strict') {
    brushCursor.style.display = 'none';
    return;
  }
  const r = viewCanvas.getBoundingClientRect();
  const scale = r.width / viewCanvas.width;
  const d = Math.max(4, brushRadius() * 2 * scale);
  const isProtect = $<HTMLSelectElement>('mask-target').value === 'protect';
  brushCursor.style.display = 'block';
  brushCursor.style.width = `${d}px`;
  brushCursor.style.height = `${d}px`;
  brushCursor.style.left = `${ev.clientX}px`;
  brushCursor.style.top = `${ev.clientY}px`;
  brushCursor.style.borderColor = isProtect ? '#34d399' : '#fb7185';
  brushCursor.style.background = isProtect ? 'rgba(16, 185, 129, 0.12)' : 'rgba(244, 63, 94, 0.12)';
}

viewCanvas.addEventListener('pointerenter', updateBrushCursor);
viewCanvas.addEventListener('pointerleave', () => {
  if (brushCursor) brushCursor.style.display = 'none';
});

viewCanvas.addEventListener('pointerdown', (ev) => {
  if (!baseImg) {
    $('base').click();
    return;
  }
  viewCanvas.setPointerCapture(ev.pointerId);
  const p = canvasPoint(ev);
  dragPoints = [{ x: p.fx, y: p.fy }];
  updateBrushCursor(ev);
});

viewCanvas.addEventListener('pointermove', (ev) => {
  updateBrushCursor(ev);
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

// Phím tắt [ / ] chỉnh cỡ cọ và Ctrl+Z / Ctrl+Y trong tab Sửa vùng
window.addEventListener('keydown', (ev) => {
  if (activeTabId !== 'tab-strict') return;
  const tag = (ev.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (ev.key === '[' || ev.key === ']') {
    ev.preventDefault();
    const slider = $<HTMLInputElement>('brush-size');
    const cur = Number(slider.value) || 30;
    const step = cur >= 60 ? 10 : 5;
    const next = Math.max(2, Math.min(300, cur + (ev.key === ']' ? step : -step)));
    slider.value = String(next);
    $('brush-val').textContent = String(next);
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !ev.shiftKey) {
    ev.preventDefault();
    $('mask-undo').click();
  } else if ((ev.ctrlKey || ev.metaKey) && (ev.key.toLowerCase() === 'y' || (ev.shiftKey && ev.key.toLowerCase() === 'z'))) {
    ev.preventDefault();
    $('mask-redo').click();
  }
});

const featherInput = $<HTMLInputElement>('feather');
featherInput.addEventListener('input', () => {
  $('feather-val').textContent = featherInput.value;
});

function drawResultLoaded(imgData: Loaded): void {
  resultCanvas.width = imgData.width;
  resultCanvas.height = imgData.height;
  resultCanvas.getContext('2d')!.putImageData(
    new ImageData(new Uint8ClampedArray(imgData.rgba), imgData.width, imgData.height),
    0,
    0,
  );
}

// Nút nhấn giữ đối chiếu Ảnh gốc trước/sau
const cmpOrigBtn = document.getElementById('compare-strict-orig');
cmpOrigBtn?.addEventListener('pointerdown', () => {
  if (baseImg) drawResultLoaded(baseImg);
});
const restoreResultCanvas = (): void => {
  if (lastDecodedResult) drawResultLoaded(lastDecodedResult);
};
cmpOrigBtn?.addEventListener('pointerup', restoreResultCanvas);
cmpOrigBtn?.addEventListener('pointerleave', restoreResultCanvas);

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
      `✓ ${r.passed ? 'ĐẠT CHUẨN STRICT (100% pixel ngoài vùng giữ nguyên tuyệt đối)' : 'KHÔNG ĐẠT'} • Nhãn: ${res.label}`,
      `Tổng pixel ngoài vùng sửa: ${r.outsidePixelCount.toLocaleString()} • Số pixel bị lệch: ${r.outsideChangedPixels}`,
      `SHA-256 PNG xuất ra: ${r.outputFileHash}`,
      `Codec kiểm định: ${r.encoderVersion}`,
    ].join('\n'),
    r.passed ? 'ok' : 'bad',
  );

  const decoded = await webPngCodec.decode(res.fileBytes);
  lastDecodedResult = decoded;
  drawResultLoaded(decoded);

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
    if (cmpOrigBtn) cmpOrigBtn.hidden = false;
  } else {
    dl.hidden = true;
    sendBtn.hidden = true;
    if (useResBtn) useResBtn.hidden = true;
    if (cmpOrigBtn) cmpOrigBtn.hidden = true;
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
interface BridgeImage { index: number; url: string; label?: string; order?: number }
interface BridgeJob {
  id: string; state: string; prompt?: string; model?: string; aspect_ratio?: string; count?: number;
  labels?: string[]; created_at?: number; error?: string | null; steps: BridgeStep[]; images: BridgeImage[];
}

function say(msg: string): void {
  $('jobmsg').textContent = msg;
}

let bridgeJobs: BridgeJob[] = [];
let jobsViewMode: 'library' | 'grouped' = 'library';
let jobsStateFilter: 'all' | 'running' | 'done' | 'error' = 'all';
let jobsSearchQuery = '';
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
    showToast('Đã đưa ảnh vào bộ Reference!', 'ok');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showToast(msg, 'error');
    log('error', msg, jobId);
  }
}

async function sendJobImageToStrict(img: BridgeImage, jobId: string): Promise<void> {
  try {
    const res = await bridgeFetch(img.url);
    if (!res.ok) throw new Error(`Không tải được ảnh (HTTP ${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    await loadBytesIntoStrictBase(bytes, `Job #${jobId.slice(0, 8)} • Ảnh ${img.order ?? img.index + 1}`);
    switchTab('tab-strict');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showToast(msg, 'error');
    log('error', msg, jobId);
  }
}

function deleteJobById(jobId: string): void {
  stopPolling(jobId);
  loggedSteps.delete(jobId);
  bridgeJobs = bridgeJobs.filter((j) => j.id !== jobId);
  saveJobs();
  renderBridgeJobs();
}

function clearFailedJobs(): void {
  const failedIds = bridgeJobs.filter((j) => j.state === 'error').map((j) => j.id);
  for (const id of failedIds) {
    stopPolling(id);
    loggedSteps.delete(id);
  }
  bridgeJobs = bridgeJobs.filter((j) => j.state !== 'error');
  saveJobs();
  renderBridgeJobs();
  showToast(`Đã dọn ${failedIds.length} job lỗi.`, 'info', 2000);
}

function clearAllJobs(): void {
  if (bridgeJobs.length > 0 && !window.confirm('Xóa toàn bộ hình đã generate và lịch sử job trong trình duyệt?')) return;
  for (const j of bridgeJobs) stopPolling(j.id);
  pollers.clear();
  loggedSteps.clear();
  bridgeJobs = [];
  saveJobs();
  renderBridgeJobs();
  log('info', 'Đã xóa toàn bộ hình đã generate và lịch sử job.');
  showToast('Đã xóa toàn bộ lịch sử Job.', 'info', 2000);
}

function buildSlotCard(job: BridgeJob, slotOrder: number, totalSlots: number, showJobMeta: boolean): HTMLElement {
  const idx = slotOrder - 1;
  const imgItem = job.images?.find((im) => im.order === slotOrder) ?? job.images?.[idx];
  const isFinal = FINAL_STATES.has(job.state);
  const slotLabel = imgItem?.label || job.labels?.[idx] || '';
  const latestStep = job.steps?.length ? job.steps[job.steps.length - 1]!.msg : (STATE_LABEL[job.state] ?? job.state);

  const card = el('div', 'job-slot-card');
  if (!imgItem && !isFinal) card.classList.add('is-generating');
  if (!imgItem && isFinal) card.classList.add('is-error');

  const thumb = el('div', 'job-slot-thumb');
  const badgeText = totalSlots > 1
    ? `Ảnh ${slotOrder}/${totalSlots}${slotLabel ? ` • ${slotLabel}` : ''}`
    : (slotLabel || 'Ảnh 1/1');
  thumb.append(el('span', 'job-slot-badge', badgeText));

  if (imgItem) {
    const fullUrl = `${API_URL}${imgItem.url}`;
    const dlUrl = `${fullUrl}?download=true`;
    const dlName = `flow_${job.id.slice(0, 8)}_${slotOrder}.jpg`;
    thumb.append(el('span', 'job-slot-status-tag done', 'Hoàn tất'));
    const img = el('img');
    img.src = fullUrl;
    img.alt = badgeText;
    img.loading = 'lazy';
    img.addEventListener('click', () => {
      openLightbox({
        src: fullUrl,
        title: `${badgeText} (#${job.id.slice(0, 8)})`,
        subtitle: job.prompt ? job.prompt.slice(0, 100) : (job.model ?? 'Google Flow'),
        downloadUrl: dlUrl,
        downloadName: dlName,
      });
    });
    thumb.append(img);
  } else if (!isFinal) {
    thumb.classList.add('shimmer');
    thumb.append(el('span', 'job-slot-status-tag running', STATE_LABEL[job.state] ?? 'Đang tạo'));
    thumb.append(
      el('div', 'slot-spinner'),
      el('div', 'slot-placeholder-title', `Đang tạo ảnh ${slotOrder}/${totalSlots}...`),
      el('div', 'slot-placeholder-sub', latestStep),
    );
  } else {
    thumb.append(el('span', 'job-slot-status-tag error', 'Thất bại'));
    thumb.append(
      el('div', 'slot-placeholder-title', `Ảnh ${slotOrder}/${totalSlots} không thành công`),
      el('div', 'slot-placeholder-sub', job.error ?? 'Job kết thúc trước khi tạo xong ảnh này.'),
    );
  }
  card.append(thumb);

  const body = el('div', 'job-slot-body');
  if (showJobMeta) {
    const metaRow = el('div', 'job-slot-meta');
    metaRow.title = job.prompt ?? '';
    metaRow.textContent = `#${job.id.slice(0, 8)} • ${job.model ?? 'Flow'}${job.aspect_ratio ? ` • ${job.aspect_ratio}` : ''}${job.prompt ? ` — ${job.prompt}` : ''}`;
    body.append(metaRow);
  }

  const actions = el('div', 'job-slot-actions');
  if (imgItem) {
    const dl = el('a', undefined, 'Tải về');
    dl.href = `${API_URL}${imgItem.url}?download=true`;
    dl.download = `flow_${job.id.slice(0, 8)}_${slotOrder}.jpg`;
    const useRef = el('button', undefined, 'Dùng làm ref');
    useRef.type = 'button';
    useRef.addEventListener('click', () => void useImageAsRef(imgItem, job.id));
    const toStrict = el('button', undefined, 'Sửa vùng');
    toStrict.type = 'button';
    toStrict.addEventListener('click', () => void sendJobImageToStrict(imgItem, job.id));
    actions.append(dl, useRef, toStrict);
  } else {
    const statusInfo = el('span', 'job-meta-text', !isFinal ? 'Đang xử lý trên Google Flow...' : 'Không có dữ liệu ảnh');
    actions.append(statusInfo);
    if (showJobMeta) {
      const delBtn = el('button', undefined, 'Xóa job');
      delBtn.type = 'button';
      delBtn.addEventListener('click', () => deleteJobById(job.id));
      actions.append(delBtn);
    }
  }
  body.append(actions);
  card.append(body);
  return card;
}

function matchesJobFilter(job: BridgeJob): boolean {
  const isFinal = FINAL_STATES.has(job.state);
  if (jobsStateFilter === 'running' && isFinal) return false;
  if (jobsStateFilter === 'done' && job.state !== 'done') return false;
  if (jobsStateFilter === 'error' && job.state !== 'error') return false;

  if (jobsSearchQuery) {
    const q = jobsSearchQuery.toLowerCase();
    const hay = `${job.id} ${job.prompt ?? ''} ${job.model ?? ''} ${(job.labels ?? []).join(' ')}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function renderBridgeJobs(): void {
  $('job-count').textContent = String(bridgeJobs.length);

  const statsBox = document.getElementById('jobs-stats');
  let totalSlotsCount = 0;
  let completedImagesCount = 0;
  let generatingSlotsCount = 0;
  let failedJobsCount = 0;
  for (const job of bridgeJobs) {
    const slots = Math.max(Number(job.count) || 1, job.images?.length || 0);
    const done = job.images?.length || 0;
    totalSlotsCount += slots;
    completedImagesCount += done;
    if (!FINAL_STATES.has(job.state)) generatingSlotsCount += Math.max(0, slots - done);
    if (job.state === 'error') failedJobsCount += 1;
  }

  const liveDot = document.getElementById('job-live-dot');
  if (liveDot) liveDot.hidden = generatingSlotsCount === 0;

  if (statsBox) {
    statsBox.replaceChildren();
    const makePill = (label: string, val: string | number, active = false): HTMLElement => {
      const p = el('span', active ? 'jobs-stat-pill active-pill' : 'jobs-stat-pill');
      p.append(document.createTextNode(`${label}: `), el('b', undefined, String(val)));
      return p;
    };
    statsBox.append(
      makePill('Tổng Job', bridgeJobs.length),
      makePill('Tổng ô hình', totalSlotsCount),
      makePill('Đang generate', generatingSlotsCount, generatingSlotsCount > 0),
      makePill('Đã hoàn tất', completedImagesCount),
    );
    if (failedJobsCount > 0) statsBox.append(makePill('Job lỗi', failedJobsCount));
  }

  const clearAllBtn = document.getElementById('clear-all-jobs') as HTMLButtonElement | null;
  if (clearAllBtn) clearAllBtn.disabled = bridgeJobs.length === 0;
  const clearFailedBtn = document.getElementById('clear-failed-jobs') as HTMLButtonElement | null;
  if (clearFailedBtn) clearFailedBtn.disabled = failedJobsCount === 0;

  const box = $('jobs');
  if (bridgeJobs.length === 0) {
    const wrap = el('div');
    wrap.style.cssText = 'text-align:center; padding:36px 16px;';
    wrap.append(
      el('p', 'card-sub', 'Chưa có hình hoặc job nào. Khi bấm Generate ở bất kỳ công cụ nào, toàn bộ ô hình sẽ hiển thị tức thì tại đây.'),
    );
    const goStudio = el('button', 'sm primary', '🎨 Mở công cụ Phối ảnh');
    goStudio.type = 'button';
    goStudio.style.marginTop = '10px';
    goStudio.addEventListener('click', () => switchTab('tab-studio'));
    wrap.append(goStudio);
    box.replaceChildren(wrap);
    return;
  }

  const filtered = bridgeJobs.filter(matchesJobFilter);
  if (filtered.length === 0) {
    box.replaceChildren(el('p', 'card-sub', 'Không có job nào khớp với bộ lọc / từ khóa tìm kiếm hiện tại.'));
    return;
  }

  if (jobsViewMode === 'library') {
    const grid = el('div', 'jobs-grid-library');
    for (const job of filtered) {
      const totalSlots = Math.max(Number(job.count) || 1, job.images?.length || 0);
      for (let slotOrder = 1; slotOrder <= totalSlots; slotOrder++) {
        grid.append(buildSlotCard(job, slotOrder, totalSlots, true));
      }
    }
    box.replaceChildren(grid);
    return;
  }

  box.replaceChildren(...filtered.map((job) => {
    const isFinal = FINAL_STATES.has(job.state);
    const totalSlots = Math.max(Number(job.count) || 1, job.images?.length || 0);
    const doneCount = job.images?.length || 0;

    const card = el('div', 'job-card');
    if (!isFinal) card.classList.add('is-running');
    if (job.state === 'error') card.classList.add('is-error');

    const head = el('div', 'job-card-head');
    const titleWrap = el('div', 'job-card-title');
    titleWrap.append(
      el('span', 'job-id-pill', `#${job.id.slice(0, 8)}`),
      el(
        'span',
        job.state === 'error' ? 'badge danger' : isFinal ? 'badge ok' : 'badge warn',
        `${STATE_LABEL[job.state] ?? job.state} (${doneCount}/${totalSlots} ảnh)`,
      ),
      el('span', 'job-meta-text', [job.model, job.aspect_ratio].filter(Boolean).join(' • ')),
    );

    const headActions = el('div', 'jobs-actions');
    if (doneCount > 1) {
      const zipBtn = el('button', 'sm', '⬇ Tải ZIP');
      zipBtn.type = 'button';
      zipBtn.addEventListener('click', () => window.open(`${API_URL}/jobs/${job.id}/zip`, '_blank'));
      headActions.append(zipBtn);
    }
    const delBtn = el('button', 'sm danger', 'Xóa job');
    delBtn.type = 'button';
    delBtn.addEventListener('click', () => deleteJobById(job.id));
    headActions.append(delBtn);

    head.append(titleWrap, headActions);
    card.append(head);

    if (job.prompt) {
      const p = el('div', 'job-prompt-text', job.prompt);
      p.title = job.prompt;
      card.append(p);
    }
    if (job.error) {
      card.append(el('div', 'alert bad', `Lỗi: ${job.error}`));
    }

    const grid = el('div', 'jobs-grid-library');
    for (let slotOrder = 1; slotOrder <= totalSlots; slotOrder++) {
      grid.append(buildSlotCard(job, slotOrder, totalSlots, false));
    }
    card.append(grid);

    if (job.steps?.length) {
      const details = el('details', 'job-steps-details');
      if (!isFinal || job.state === 'error') details.open = true;
      const latestMsg = job.steps[job.steps.length - 1]?.msg ?? '';
      details.append(el('summary', undefined, `Nhật ký thực thi (${job.steps.length} bước)${latestMsg ? ` — ${latestMsg}` : ''}`));
      const ol = el('ol');
      for (const s of job.steps) ol.append(el('li', undefined, s.msg));
      details.append(ol);
      card.append(details);
    }

    return card;
  }));
}

document.getElementById('jobs-view-library')?.addEventListener('click', () => {
  jobsViewMode = 'library';
  document.getElementById('jobs-view-library')?.classList.add('active');
  document.getElementById('jobs-view-grouped')?.classList.remove('active');
  renderBridgeJobs();
});

document.getElementById('jobs-view-grouped')?.addEventListener('click', () => {
  jobsViewMode = 'grouped';
  document.getElementById('jobs-view-grouped')?.classList.add('active');
  document.getElementById('jobs-view-library')?.classList.remove('active');
  renderBridgeJobs();
});

document.querySelectorAll<HTMLButtonElement>('#jobs-state-filter .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    jobsStateFilter = (btn.dataset.filter as typeof jobsStateFilter) || 'all';
    document.querySelectorAll('#jobs-state-filter .seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
    renderBridgeJobs();
  });
});

document.getElementById('jobs-search')?.addEventListener('input', (ev) => {
  jobsSearchQuery = (ev.currentTarget as HTMLInputElement).value.trim();
  renderBridgeJobs();
});

document.getElementById('clear-all-jobs')?.addEventListener('click', () => {
  clearAllJobs();
});

document.getElementById('clear-failed-jobs')?.addEventListener('click', () => {
  clearFailedJobs();
});

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

function readCount(): number {
  const input = $<HTMLInputElement>('out-count');
  const n = Math.min(8, Math.max(1, Math.round(Number(input.value) || 1)));
  input.value = String(n);
  syncCountPills();
  return n;
}

$('newjob').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('newjob');
  try {
    const doc = await runCompile();
    if (hasBlockingWarning(doc)) {
      say('Còn cảnh báo chặn (màu đỏ). Hãy sửa trước khi tạo job.');
      showToast('Còn cảnh báo chặn màu đỏ, hãy kiểm tra lại Prompt.', 'warn');
      return;
    }
    if (!doc.compiledText.trim()) {
      say('Prompt đang trống.');
      showToast('Hãy nhập mô tả cảnh trước khi Generate.', 'warn');
      $<HTMLTextAreaElement>('brief').focus();
      return;
    }
    const model = selectedModel();
    if (!model) {
      say('Hãy chọn model.');
      showToast('Chưa chọn model (hoặc Bridge chưa kết nối).', 'warn');
      return;
    }

    btn.disabled = true;
    const references = refs
      .filter((r) => r.binding.active && r.asset.id !== baseAssetId)
      .map((r) => ({ name: r.binding.handle, mime: r.asset.mimeType, base64: base64FromBytes(r.bytes) }));
    const baseItem = refs.find((r) => r.asset.id === baseAssetId);
    const base = baseItem
      ? { name: baseItem.binding.handle ?? 'base', mime: baseItem.asset.mimeType, base64: base64FromBytes(baseItem.bytes) }
      : null;
    const body = {
      prompt: doc.compiledText,
      model,
      aspect_ratio: $<HTMLSelectElement>('ratio').value,
      count: readCount(),
      remove_watermark: $<HTMLInputElement>('remove-watermark').checked,
      ...readSize(),
      references,
      base,
    };
    say('Đang gửi job tới bridge server...');
    const res = await bridgeFetch('/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Bridge từ chối job (HTTP ${res.status}): ${await res.text()}`);
    const job = (await res.json()) as BridgeJob;
    job.prompt ??= body.prompt;
    job.aspect_ratio ??= body.aspect_ratio;
    job.count ??= body.count;
    upsertJob(job);
    startPolling(job.id);
    say(`Đã tạo job #${job.id.slice(0, 8)}. Xem tiến độ ở tab Thư viện Job.`);
    showToast(`Đã gửi Job #${job.id.slice(0, 8)} (${body.count} ảnh)!`, 'ok');
    switchTab('tab-jobs');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    say(msg);
    showToast(msg, 'error');
    log('error', msg);
  } finally {
    btn.disabled = false;
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
  const validOpts = [...src.options].filter((o) => o.value && o.value !== '__custom__');
  dst.replaceChildren(...validOpts.map((o) => new Option(o.text, o.value)));
  if ([...dst.options].some((o) => o.value === prev)) dst.value = prev;
  else if ([...dst.options].some((o) => o.value === 'nano-banana-pro')) dst.value = 'nano-banana-pro';

  for (const id of ['room-model', 'cam-model']) {
    const roomModel = document.getElementById(id) as HTMLSelectElement | null;
    if (!roomModel) continue;
    const prevR = roomModel.value;
    roomModel.replaceChildren(...validOpts.map((o) => new Option(o.text, o.value)));
    if ([...roomModel.options].some((o) => o.value === prevR)) roomModel.value = prevR;
    else if ([...roomModel.options].some((o) => o.value === 'nano-banana-pro')) roomModel.value = 'nano-banana-pro';
  }

  const assetModel = document.getElementById('asset-model') as HTMLSelectElement | null;
  if (assetModel) {
    const prevA = assetModel.value;
    assetModel.replaceChildren(...validOpts.map((o) => new Option(o.text, o.value)));
    if ([...assetModel.options].some((o) => o.value === prevA)) assetModel.value = prevA;
  }
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

async function waitJob(id: string, onProgress?: (job: BridgeJob) => void): Promise<BridgeJob> {
  for (;;) {
    const res = await bridgeFetch(`/jobs/${id}`);
    if (!res.ok) throw new Error(`Không đọc được job (HTTP ${res.status})`);
    const job = (await res.json()) as BridgeJob;
    upsertJob(job);
    onProgress?.(job);
    if (FINAL_STATES.has(job.state)) return job;
    setEditStatus(`${STATE_LABEL[job.state] ?? job.state}...`);
    await new Promise((r) => window.setTimeout(r, 1500));
  }
}

const MAX_EDIT_REFS = 4;
let editRefs: { name: string; mime: string; base64: string; url: string }[] = [];

function renderEditRefs(): void {
  const box = $('strict-ref-list');
  box.replaceChildren();
  editRefs.forEach((r, i) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative; width:72px; text-align:center; font-size:11px;';
    const img = document.createElement('img');
    img.src = r.url;
    img.alt = r.name;
    img.style.cssText = 'width:72px; height:72px; object-fit:cover; border-radius:6px; display:block; cursor:zoom-in; border:1px solid var(--border);';
    img.addEventListener('click', () => openLightbox({ src: r.url, title: `Ảnh ${i + 2} • ${r.name}` }));
    const label = document.createElement('div');
    label.textContent = `Ảnh ${i + 2}`;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sm danger';
    del.textContent = 'Xóa';
    del.addEventListener('click', () => {
      URL.revokeObjectURL(r.url);
      editRefs = editRefs.filter((x) => x !== r);
      renderEditRefs();
    });
    wrap.append(img, label, del);
    box.append(wrap);
  });
}

$<HTMLInputElement>('strict-ref-input').addEventListener('change', async (ev) => {
  const input = ev.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  for (const f of files) {
    if (editRefs.length >= MAX_EDIT_REFS) { setEditStatus(`Tối đa ${MAX_EDIT_REFS} ảnh tham chiếu.`); break; }
    if (f.size > 8 * 1024 * 1024) { setEditStatus(`${f.name} lớn hơn 8 MB, bỏ qua.`); continue; }
    editRefs.push({ name: f.name, mime: f.type || 'image/png', base64: await blobToBase64(f), url: URL.createObjectURL(f) });
  }
  renderEditRefs();
});

$<HTMLInputElement>('strict-feather').addEventListener('input', () => {
  $('strict-feather-val').textContent = $<HTMLInputElement>('strict-feather').value;
});

$('edit-generate').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('edit-generate');
  try {
    if (!baseImg || !allowLayer || !protectLayer) {
      setEditStatus('Hãy nạp Ảnh gốc trước.');
      showToast('Hãy nạp Ảnh gốc trước khi sửa vùng.', 'warn');
      return;
    }
    const mode = $<HTMLSelectElement>('edit-mode').value;
    const prompt = $<HTMLTextAreaElement>('edit-prompt').value.trim();
    if (mode === 'edit' && !prompt) {
      setEditStatus('Hãy nhập prompt mô tả cần sửa.');
      showToast('Hãy nhập mô tả vùng cần sửa.', 'warn');
      $<HTMLTextAreaElement>('edit-prompt').focus();
      return;
    }
    const model = $<HTMLSelectElement>('edit-model').value;
    if (!model) {
      setEditStatus('Chưa có model (bridge server chưa kết nối?).');
      showToast('Chưa kết nối được Bridge Server.', 'error');
      return;
    }
    const mask = effectiveMask(allowLayer.data, protectLayer.data, baseImg.width, baseImg.height);
    if (!mask.some((v) => v === 1)) {
      setEditStatus('Chưa tô vùng nào. Dùng Cọ tô để bôi vùng cần sửa.');
      showToast('Hãy dùng Cọ tô đỏ vùng cần sửa trên ảnh.', 'warn');
      return;
    }

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
      references: editRefs.map((r) => ({ name: r.name, mime: r.mime, base64: r.base64 })),
      marker_color: $<HTMLSelectElement>('strict-marker-color').value,
      composite_back: $<HTMLInputElement>('strict-composite').checked,
      remove_watermark: $<HTMLInputElement>('remove-watermark').checked,
      feather_px: Number($<HTMLInputElement>('strict-feather').value) || 0,
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
      b.type = 'button';
      b.className = 'sm';
      b.textContent = `Ảnh ${im.index + 1}`;
      b.addEventListener('click', () => void useEditResult(job, im).catch((e) => setEditStatus(String(e instanceof Error ? e.message : e))));
      box.append(b);
    }
    await useEditResult(job, job.images[0]!);
    showToast('Đã sửa vùng & ghép kiểm định Strict thành công!', 'ok');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setEditStatus(msg);
    showToast(msg, 'error');
    log('error', msg);
  } finally {
    btn.disabled = false;
  }
});

// ---- Trạng thái bridge / FlowKit ở thanh trên cùng ----
type BridgeView = 'offline' | 'no-flow' | 'cooldown' | 'ready';

function showBridgeStatus(view: BridgeView, cooldownS = 0): void {
  const badge = $('bridge-status');
  const map: Record<BridgeView, { cls: string; text: string; title: string }> = {
    offline: { cls: 'badge danger', text: '● Bridge: tắt', title: 'Không kết nối được bridge server (127.0.0.1:8200). Hãy chạy run.bat và giữ cửa sổ đó mở.' },
    'no-flow': { cls: 'badge warn', text: '● FlowKit: chờ kết nối', title: 'Bridge đang chạy nhưng FlowKit extension chưa kết nối. Mở tab flow.google.com đã đăng nhập.' },
    cooldown: { cls: 'badge warn', text: `⏳ Nghỉ ${cooldownS}s`, title: 'Google báo unusual activity. Bridge tạm nghỉ trước khi gửi tiếp.' },
    ready: { cls: 'badge ok', text: '● Flow: sẵn sàng', title: 'Bridge và FlowKit extension đã kết nối. Có thể tạo ảnh ngay.' },
  };
  const v = map[view];
  badge.className = v.cls;
  badge.textContent = v.text;
  badge.title = v.title;
}

async function watchBridge(onBackOnline: () => void): Promise<void> {
  let last: BridgeView | null = null;
  let needReload = $<HTMLSelectElement>('model').options.length <= 2 && !$<HTMLSelectElement>('model').value;
  for (;;) {
    let view: BridgeView = 'offline';
    let cd = 0;
    try {
      const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const h = (await res.json()) as { extension_connected?: boolean; cooldown_remaining_s?: number };
        cd = Math.ceil(Number(h.cooldown_remaining_s ?? 0));
        view = !h.extension_connected ? 'no-flow' : cd > 0 ? 'cooldown' : 'ready';
      }
    } catch { /* offline */ }
    showBridgeStatus(view, cd);
    if (view !== last) {
      if (view === 'offline') {
        needReload = true;
        log('warn', 'Mất kết nối bridge server (127.0.0.1:8200). Hãy chạy run.bat.');
      } else {
        if (last === 'offline') log('info', 'Đã kết nối lại bridge server.');
        if (view === 'no-flow') log('warn', 'FlowKit extension chưa kết nối. Mở tab flow.google.com đã đăng nhập trong Chrome có nạp FlowKit.');
        if (view === 'ready' && last !== 'cooldown') log('info', 'FlowKit extension đã kết nối. Sẵn sàng tạo ảnh với Google Flow.');
        if (needReload) {
          needReload = false;
          await fetchModels();
          syncEditModels();
          onBackOnline();
        }
      }
      last = view;
    }
    await new Promise((r) => window.setTimeout(r, view === 'offline' ? 3000 : 5000));
  }
}

async function initBridge(): Promise<void> {
  try {
    bridgeJobs = JSON.parse(localStorage.getItem(JOBS_KEY) ?? '[]') as BridgeJob[];
  } catch { bridgeJobs = []; }
  for (const j of bridgeJobs) loggedSteps.set(j.id, j.steps?.length ?? 0);
  renderBridgeJobs();
  await restoreRefsFromDb();
  await fetchModels();
  syncEditModels();

  const animController = initAnimTab({
    bridgeFetch,
    waitJob,
    log,
    getBridgeUrl: () => API_URL,
    getStrictLastResultBytes: () => lastResultBytes,
  });

  const videoController = initVideoTab({
    bridgeFetch,
    log,
    getBridgeUrl: () => API_URL,
    getImageResultBytes: () => lastResultBytes,
  });
  void watchBridge(() => void videoController.reloadCaps());

  initAssetTab({
    bridgeFetch,
    waitJob,
    log,
    switchTab,
    getBridgeUrl: () => API_URL,
    getTab1Refs: () => refs.map((r) => ({
      name: r.binding.handle || r.binding.alias,
      mime: r.asset.mimeType,
      base64: base64FromBytes(r.bytes),
      dataUrl: r.objectUrl,
    })),
    sendToStrictTab: async (bytes, label) => {
      await loadBytesIntoStrictBase(bytes, label);
    },
    sendToAnimTab: async (file) => {
      await animController.setCharacterFile(file);
    },
  });

  initRoomTab({
    bridgeFetch,
    waitJob,
    log,
    switchTab,
    getBridgeUrl: () => API_URL,
    getRemoveWatermark: () => $<HTMLInputElement>('remove-watermark').checked,
    addAsReference: async (file) => { await addReferenceFiles([file]); },
    sendToStrictTab: async (bytes, label) => { await loadBytesIntoStrictBase(bytes, label); },
  });

  initCameraTab({
    bridgeFetch,
    waitJob,
    log,
    switchTab,
    getBridgeUrl: () => API_URL,
    getRemoveWatermark: () => $<HTMLInputElement>('remove-watermark').checked,
    addAsReference: async (file) => { await addReferenceFiles([file]); },
    sendToStrictTab: async (bytes, label) => { await loadBytesIntoStrictBase(bytes, label); },
  });

  // Gắn Ví Token Topbar + Thanh Pre-flight Token sau khi toàn bộ tab đã render xong bộ đếm
  mountAllCreditBars();

  for (const j of bridgeJobs) if (!FINAL_STATES.has(j.state)) startPolling(j.id);
}
void initBridge();
