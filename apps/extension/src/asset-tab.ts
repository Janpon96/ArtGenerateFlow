/**
 * asset-tab.ts: Xử lý tương tác Tab Game Asset Generator.
 */

import { openLightbox, showToast } from './ui-helpers';

export interface AssetRef {
  name: string;
  mime: string;
  base64: string;
  dataUrl: string;
}

export interface BridgeJobResult {
  id: string;
  state: string;
  count?: number;
  steps?: Array<{ msg: string }>;
  images?: Array<{ index: number; url: string; file_path?: string; order?: number }>;
  frames?: Array<{ index: number; url: string; file_path?: string }>;
  metrics?: Record<string, unknown>;
  error?: string | null;
}

export interface AssetTabContext {
  bridgeFetch: (path: string, init?: RequestInit) => Promise<Response>;
  waitJob: (id: string, onProgress?: (job: BridgeJobResult) => void) => Promise<BridgeJobResult>;
  log: (level: 'info' | 'warn' | 'error', msg: string, jobId?: string) => void;
  switchTab: (tabId: string) => void;
  getTab1Refs: () => Array<{ name: string; mime: string; base64: string; dataUrl: string }>;
  sendToStrictTab: (bytes: Uint8Array, label: string) => Promise<void>;
  sendToAnimTab: (file: File) => Promise<void>;
  getBridgeUrl: () => string;
}

const ASSET_PROMPT_SUGGESTIONS: Record<string, string[]> = {
  character: [
    'chibi knight character in silver armor holding glowing blue sword, full body standing idle pose',
    'cute forest mage girl with oversized witch hat and wooden staff, front-three-quarter view',
  ],
  item: [
    'ornate wooden treasure chest with gold trim and glowing ruby lock, closed, isometric angle',
    'glass healing potion bottle filled with glowing crimson liquid, cork stopper, game icon',
    'legendary crystal greatsword with runes along the blade, diagonal RPG inventory icon',
  ],
  tile: [
    'seamless mossy cobblestone dungeon floor tile, top-down 2D RPG tileset',
    'isometric grassy cliff block with wildflowers and dirt cross-section',
  ],
  ui: [
    'fantasy RPG wooden dialogue frame with golden corner ornaments and parchment center',
    'glossy emerald fantasy action button frame with rune border',
  ],
  background: [
    'cozy medieval alchemist shop interior with glowing potion shelves and warm lantern light',
    'parallax enchanted forest background at twilight with bioluminescent mushrooms',
  ],
  fx: [
    'stylized 2D golden slash arc impact VFX sprite, crisp edges',
    'magical arcane explosion burst with purple sparkles and energy ring',
  ],
};

export function initAssetTab(ctx: AssetTabContext): void {
  const $ = <T extends HTMLElement>(id: string) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Không tìm thấy phần tử #${id}`);
    return el as T;
  };

  const assetRefs: AssetRef[] = [];

  function renderAssetRefs(): void {
    const box = $('asset-refs-list');
    box.replaceChildren();
    if (assetRefs.length === 0) {
      const sp = document.createElement('span');
      sp.className = 'card-sub';
      sp.style.fontSize = '12px';
      sp.style.alignSelf = 'center';
      sp.textContent = 'Kéo thả ảnh vào đây hoặc chọn tệp phía trên để đồng bộ nét vẽ & bảng màu.';
      box.append(sp);
      return;
    }

    for (let i = 0; i < assetRefs.length; i++) {
      const ref = assetRefs[i]!;
      const item = document.createElement('div');
      item.className = 'mini-ref-thumb';

      const img = document.createElement('img');
      img.src = ref.dataUrl;
      img.alt = ref.name;
      img.title = `${ref.name} (Bấm để phóng to)`;
      img.addEventListener('click', () => {
        openLightbox({ src: ref.dataUrl, title: ref.name, subtitle: 'Style Reference' });
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'mini-ref-del';
      delBtn.textContent = '×';
      delBtn.title = 'Xóa khỏi Style Ref';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        assetRefs.splice(i, 1);
        renderAssetRefs();
      });

      item.append(img, delBtn);
      box.append(item);
    }
  }

  async function ingestFiles(files: Iterable<File>): Promise<void> {
    let added = 0;
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      const buf = await f.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunk = 0x8000;
      for (let j = 0; j < bytes.length; j += chunk) {
        binary += String.fromCharCode(...bytes.subarray(j, j + chunk));
      }
      const b64 = btoa(binary);
      const dataUrl = `data:${f.type || 'image/png'};base64,${b64}`;
      assetRefs.push({ name: f.name, mime: f.type || 'image/png', base64: b64, dataUrl });
      added++;
    }
    if (added > 0) {
      renderAssetRefs();
      showToast(`Đã thêm ${added} ảnh Style Reference`, 'ok', 2200);
    }
  }

  // Chọn file style ref + kéo thả vào khung danh sách
  $('asset-ref-input').addEventListener('change', async () => {
    const input = $<HTMLInputElement>('asset-ref-input');
    if (input.files) await ingestFiles(Array.from(input.files));
    input.value = '';
  });

  const refsBox = $('asset-refs-list');
  refsBox.addEventListener('dragover', (e) => {
    e.preventDefault();
    refsBox.classList.add('dragover');
  });
  refsBox.addEventListener('dragleave', () => refsBox.classList.remove('dragover'));
  refsBox.addEventListener('drop', (e) => {
    e.preventDefault();
    refsBox.classList.remove('dragover');
    if (e.dataTransfer?.files) void ingestFiles(Array.from(e.dataTransfer.files));
  });

  // Đồng bộ refs từ Tab 1
  $('asset-sync-refs').addEventListener('click', () => {
    const t1 = ctx.getTab1Refs();
    if (t1.length === 0) {
      showToast('Tab Phối ảnh (Multi-Ref) chưa có ảnh tham chiếu nào.', 'warn');
      return;
    }
    assetRefs.length = 0;
    assetRefs.push(...t1);
    renderAssetRefs();
    showToast(`Đã đồng bộ ${t1.length} ảnh từ Tab Phối ảnh!`, 'ok');
  });

  // Xóa danh sách refs
  $('asset-clear-refs').addEventListener('click', () => {
    if (!assetRefs.length) return;
    assetRefs.length = 0;
    renderAssetRefs();
    showToast('Đã xóa danh sách Style Ref.', 'info', 2000);
  });

  // Gợi ý prompt nhanh theo loại Asset
  function renderQuickIdeas(): void {
    const host = document.getElementById('asset-quick-ideas');
    if (!host) return;
    const kind = $<HTMLSelectElement>('asset-type').value;
    const list = ASSET_PROMPT_SUGGESTIONS[kind] ?? ASSET_PROMPT_SUGGESTIONS.item!;
    host.replaceChildren();
    list.forEach((sample, idx) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'preset-chip';
      chip.textContent = `💡 Mẫu ${idx + 1}: ${sample.slice(0, 42)}…`;
      chip.title = sample;
      chip.addEventListener('click', () => {
        $<HTMLTextAreaElement>('asset-prompt').value = sample;
        $<HTMLTextAreaElement>('asset-prompt').focus();
      });
      host.append(chip);
    });
  }
  $('asset-type').addEventListener('change', renderQuickIdeas);
  renderQuickIdeas();

  // Toggle kích thước custom
  $('asset-size').addEventListener('change', () => {
    const isCustom = $<HTMLSelectElement>('asset-size').value === 'custom';
    $('asset-custom-size-box').hidden = !isCustom;
  });

  function readAssetSize(): { width: number; height: number } {
    const sel = $<HTMLSelectElement>('asset-size').value;
    if (sel === 'custom') {
      const w = Number($<HTMLInputElement>('asset-w').value) || 512;
      const h = Number($<HTMLInputElement>('asset-h').value) || 512;
      return { width: Math.max(64, Math.min(4096, w)), height: Math.max(64, Math.min(4096, h)) };
    }
    const [w, h] = sel.split('x').map(Number) as [number, number];
    return { width: w || 512, height: h || 512 };
  }

  function setStatus(text: string): void {
    $('asset-status').textContent = text;
  }

  // Nút Generate Game Asset
  $('asset-generate').addEventListener('click', async () => {
    const btn = $<HTMLButtonElement>('asset-generate');
    try {
      const prompt = $<HTMLTextAreaElement>('asset-prompt').value.trim();
      if (!prompt) {
        setStatus('Hãy nhập mô tả prompt cho asset.');
        showToast('Hãy nhập mô tả prompt cho Game Asset.', 'warn');
        $<HTMLTextAreaElement>('asset-prompt').focus();
        return;
      }
      const model = $<HTMLSelectElement>('asset-model').value || 'nano-banana-2.1';
      const size = readAssetSize();
      const count = Number($<HTMLSelectElement>('asset-count').value) || 1;
      const assetType = $<HTMLSelectElement>('asset-type').value;
      const preset = $<HTMLSelectElement>('asset-preset').value;
      const transparent = $<HTMLInputElement>('asset-transparent').checked;

      btn.disabled = true;
      setStatus('Đang gửi yêu cầu tới bridge...');

      const body = {
        prompt,
        asset_type: assetType,
        style_preset: preset,
        style_refs: assetRefs.map((r) => ({ name: r.name, mime: r.mime, base64: r.base64 })),
        model,
        count,
        width: size.width,
        height: size.height,
        transparent,
      };

      const res = await ctx.bridgeFetch('/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`Bridge từ chối (HTTP ${res.status}): ${await res.text()}`);
      }

      const created = (await res.json()) as BridgeJobResult;
      created.count ??= count;
      renderAssetGallery(created, count);
      setStatus(`Job #${created.id.slice(0, 8)} đã tạo (${count} asset). Đang xử lý...`);

      const job = await ctx.waitJob(created.id, (liveJob) => renderAssetGallery(liveJob, count));
      renderAssetGallery(job, count);
      if (job.state === 'error' || !job.images?.length) {
        throw new Error(job.error || 'Flow không trả ảnh nào.');
      }

      setStatus(`Hoàn tất ${job.images.length} game asset!`);
      showToast(`Đã tạo xong ${job.images.length} Game Asset!`, 'ok');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(msg);
      showToast(msg, 'error');
      ctx.log('error', msg);
    } finally {
      btn.disabled = false;
    }
  });

  function renderAssetGallery(job: BridgeJobResult, fallbackCount = 1): void {
    const gallery = $('asset-gallery');
    gallery.className = 'jobs-grid-library checkerboard';
    gallery.replaceChildren();

    const images = job.images || [];
    const zipBtn = $<HTMLButtonElement>('asset-download-zip');
    zipBtn.hidden = images.length === 0;
    zipBtn.onclick = () => {
      window.open(`${ctx.getBridgeUrl()}/jobs/${job.id}/zip`, '_blank');
    };

    const totalSlots = Math.max(Number(job.count) || fallbackCount || 1, images.length);
    const isFinal = job.state === 'done' || job.state === 'error';
    const latestStep = job.steps?.length ? job.steps[job.steps.length - 1]!.msg : 'Đang tạo asset...';

    for (let slotOrder = 1; slotOrder <= totalSlots; slotOrder++) {
      const idx = slotOrder - 1;
      const im = images.find((x) => x.order === slotOrder) ?? images[idx];

      const card = document.createElement('div');
      card.className = 'job-slot-card';
      if (!im && !isFinal) card.classList.add('is-generating');
      if (!im && isFinal) card.classList.add('is-error');

      const thumb = document.createElement('div');
      thumb.className = 'job-slot-thumb checkerboard';
      const badge = document.createElement('span');
      badge.className = 'job-slot-badge';
      badge.textContent = `Asset ${slotOrder}/${totalSlots}`;
      thumb.append(badge);

      if (im) {
        const fullUrl = `${ctx.getBridgeUrl()}${im.url}`;
        const dlUrl = `${fullUrl}?download=true`;
        const dlName = `asset_${String(job.id).slice(0, 8)}_${im.index + 1}.png`;
        const tag = document.createElement('span');
        tag.className = 'job-slot-status-tag done';
        tag.textContent = 'Hoàn tất';
        const img = document.createElement('img');
        img.src = fullUrl;
        img.alt = `Asset ${slotOrder}`;
        img.addEventListener('click', () => {
          openLightbox({
            src: fullUrl,
            title: `Game Asset ${slotOrder}/${totalSlots}`,
            subtitle: `Job #${String(job.id).slice(0, 8)}`,
            downloadUrl: dlUrl,
            downloadName: dlName,
          });
        });
        thumb.append(tag, img);
      } else if (!isFinal) {
        thumb.classList.add('shimmer');
        const tag = document.createElement('span');
        tag.className = 'job-slot-status-tag running';
        tag.textContent = 'Đang tạo';
        const spin = document.createElement('div');
        spin.className = 'slot-spinner';
        const t1 = document.createElement('div');
        t1.className = 'slot-placeholder-title';
        t1.textContent = `Đang tạo asset ${slotOrder}/${totalSlots}...`;
        const t2 = document.createElement('div');
        t2.className = 'slot-placeholder-sub';
        t2.textContent = latestStep;
        thumb.append(tag, spin, t1, t2);
      } else {
        const tag = document.createElement('span');
        tag.className = 'job-slot-status-tag error';
        tag.textContent = 'Thất bại';
        const t1 = document.createElement('div');
        t1.className = 'slot-placeholder-title';
        t1.textContent = `Asset ${slotOrder}/${totalSlots} lỗi`;
        const t2 = document.createElement('div');
        t2.className = 'slot-placeholder-sub';
        t2.textContent = job.error || 'Không tạo được asset này.';
        thumb.append(tag, t1, t2);
      }
      card.append(thumb);

      if (im) {
        const body = document.createElement('div');
        body.className = 'job-slot-body';
        const cap = document.createElement('div');
        cap.className = 'job-slot-actions';

        const dl = document.createElement('a');
        dl.textContent = 'Tải PNG';
        dl.href = `${ctx.getBridgeUrl()}${im.url}?download=true`;
        dl.download = `asset_${String(job.id).slice(0, 8)}_${im.index + 1}.png`;

        const useStyle = document.createElement('button');
        useStyle.type = 'button';
        useStyle.textContent = '+ Style Ref';
        useStyle.title = 'Đưa ảnh này vào danh sách Style Reference của Asset';
        useStyle.addEventListener('click', async () => {
          const resp = await ctx.bridgeFetch(im.url);
          const blob = await resp.blob();
          const buf = await blob.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let b64 = '';
          const chunk = 0x8000;
          for (let j = 0; j < bytes.length; j += chunk) {
            b64 += String.fromCharCode(...bytes.subarray(j, j + chunk));
          }
          const btoaStr = btoa(b64);
          assetRefs.push({
            name: `asset_${im.index + 1}.png`,
            mime: 'image/png',
            base64: btoaStr,
            dataUrl: `data:image/png;base64,${btoaStr}`,
          });
          renderAssetRefs();
          showToast('Đã thêm ảnh vào danh sách Style Ref!', 'ok');
        });

        const toAnim = document.createElement('button');
        toAnim.type = 'button';
        toAnim.textContent = 'Sang Anim';
        toAnim.title = 'Gửi ảnh này sang tab Animation để tạo chuyển động';
        toAnim.addEventListener('click', async () => {
          const resp = await ctx.bridgeFetch(im.url);
          const blob = await resp.blob();
          const file = new File([blob], `asset_anim_${Date.now()}.png`, { type: 'image/png' });
          await ctx.sendToAnimTab(file);
          ctx.switchTab('tab-anim');
          showToast('Đã nạp nhân vật sang tab Animation!', 'ok');
        });

        const toStrict = document.createElement('button');
        toStrict.type = 'button';
        toStrict.textContent = 'Sửa vùng';
        toStrict.title = 'Gửi sang tab Sửa vùng để chỉnh sửa chi tiết';
        toStrict.addEventListener('click', async () => {
          const resp = await ctx.bridgeFetch(im.url);
          const blob = await resp.blob();
          const bytes = new Uint8Array(await blob.arrayBuffer());
          await ctx.sendToStrictTab(bytes, `Asset ${im.index + 1}`);
          ctx.switchTab('tab-strict');
        });

        cap.append(dl, useStyle, toAnim, toStrict);
        body.append(cap);
        card.append(body);
      }
      gallery.append(card);
    }
  }
}
