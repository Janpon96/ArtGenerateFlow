/**
 * asset-tab.ts: Xử lý tương tác Tab Game Asset Generator.
 */

export interface AssetRef {
  name: string;
  mime: string;
  base64: string;
  dataUrl: string;
}

export interface BridgeJobResult {
  id: string;
  state: string;
  images?: Array<{ index: number; url: string; file_path?: string }>;
  frames?: Array<{ index: number; url: string; file_path?: string }>;
  metrics?: Record<string, unknown>;
  error?: string | null;
}

export interface AssetTabContext {
  bridgeFetch: (path: string, init?: RequestInit) => Promise<Response>;
  waitJob: (id: string) => Promise<BridgeJobResult>;
  log: (level: 'info' | 'warn' | 'error', msg: string, jobId?: string) => void;
  switchTab: (tabId: string) => void;
  getTab1Refs: () => Array<{ name: string; mime: string; base64: string; dataUrl: string }>;
  sendToStrictTab: (bytes: Uint8Array, label: string) => Promise<void>;
  sendToAnimTab: (file: File) => Promise<void>;
  getBridgeUrl: () => string;
}

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
      sp.textContent = 'Chưa có ảnh ref style. Thêm ảnh để nhân vật/item sinh ra có cùng nét vẽ, màu sắc.';
      box.append(sp);
      return;
    }

    for (let i = 0; i < assetRefs.length; i++) {
      const ref = assetRefs[i]!;
      const item = document.createElement('div');
      item.style.cssText = 'position:relative; width:48px; height:48px; border-radius:4px; overflow:hidden; border:1px solid #475569;';

      const img = document.createElement('img');
      img.src = ref.dataUrl;
      img.style.cssText = 'width:100%; height:100%; object-fit:cover;';
      img.title = ref.name;

      const delBtn = document.createElement('button');
      delBtn.textContent = '×';
      delBtn.style.cssText = 'position:absolute; top:1px; right:1px; background:rgba(0,0,0,0.7); color:#fff; border:none; border-radius:3px; padding:0 3px; font-size:11px; cursor:pointer;';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        assetRefs.splice(i, 1);
        renderAssetRefs();
      });

      item.append(img, delBtn);
      box.append(item);
    }
  }

  // Chọn file style ref
  $('asset-ref-input').addEventListener('change', async () => {
    const input = $<HTMLInputElement>('asset-ref-input');
    const files = input.files;
    if (!files) return;

    for (const f of Array.from(files)) {
      const buf = await f.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]!);
      const b64 = btoa(binary);
      const dataUrl = `data:${f.type || 'image/png'};base64,${b64}`;
      assetRefs.push({ name: f.name, mime: f.type || 'image/png', base64: b64, dataUrl });
    }
    input.value = '';
    renderAssetRefs();
  });

  // Đồng bộ refs từ Tab 1
  $('asset-sync-refs').addEventListener('click', () => {
    const t1 = ctx.getTab1Refs();
    if (t1.length === 0) {
      alert('Tab 1 chưa có ảnh tham chiếu nào.');
      return;
    }
    assetRefs.length = 0;
    assetRefs.push(...t1);
    renderAssetRefs();
  });

  // Xóa danh sách refs
  $('asset-clear-refs').addEventListener('click', () => {
    assetRefs.length = 0;
    renderAssetRefs();
  });

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

      const created = (await res.json()) as { id: string };
      setStatus(`Job #${created.id.slice(0, 8)} đã tạo. Đang xử lý...`);

      const job = await ctx.waitJob(created.id);
      if (job.state === 'error' || !job.images?.length) {
        throw new Error(job.error || 'Flow không trả ảnh nào.');
      }

      setStatus(`Hoàn tất ${job.images.length} game asset!`);
      renderAssetGallery(job);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(msg);
      ctx.log('error', msg);
    } finally {
      btn.disabled = false;
    }
  });

  function renderAssetGallery(job: BridgeJobResult): void {
    const gallery = $('asset-gallery');
    gallery.replaceChildren();

    const zipBtn = $<HTMLButtonElement>('asset-download-zip');
    zipBtn.hidden = false;
    zipBtn.onclick = () => {
      window.open(`${ctx.getBridgeUrl()}/jobs/${job.id}/zip`, '_blank');
    };

    const images = job.images || [];
    for (const im of images) {
      const fig = document.createElement('figure');
      fig.style.cssText = 'background:#161b22; border:1px solid #30363d; border-radius:6px; padding:6px; margin:0; display:flex; flex-direction:column; gap:6px;';

      const img = document.createElement('img');
      img.src = `${ctx.getBridgeUrl()}${im.url}`;
      img.style.cssText = 'width:100%; height:160px; object-fit:contain; border-radius:4px; cursor:pointer;';
      img.addEventListener('click', () => window.open(img.src, '_blank'));

      const cap = document.createElement('figcaption');
      cap.style.cssText = 'display:flex; flex-direction:column; gap:4px; font-size:11px;';

      const row1 = document.createElement('div');
      row1.style.cssText = 'display:flex; gap:4px; justify-content:space-between; align-items:center;';

      const dl = document.createElement('a');
      dl.className = 'btn sm primary';
      dl.textContent = 'Tải PNG';
      dl.href = `${ctx.getBridgeUrl()}${im.url}?download=true`;
      dl.download = `asset_${String(job.id).slice(0, 8)}_${im.index + 1}.png`;

      const useStyle = document.createElement('button');
      useStyle.className = 'sm';
      useStyle.textContent = '+ Ref Style';
      useStyle.title = 'Đưa ảnh này vào danh sách Style Reference của Asset';
      useStyle.addEventListener('click', async () => {
        const resp = await ctx.bridgeFetch(im.url);
        const blob = await resp.blob();
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let b64 = '';
        for (let j = 0; j < bytes.length; j++) b64 += String.fromCharCode(bytes[j]!);
        const btoaStr = btoa(b64);
        assetRefs.push({
          name: `asset_${im.index + 1}.png`,
          mime: 'image/png',
          base64: btoaStr,
          dataUrl: `data:image/png;base64,${btoaStr}`,
        });
        renderAssetRefs();
        alert('Đã thêm ảnh vào danh sách Style Ref!');
      });

      row1.append(dl, useStyle);

      const row2 = document.createElement('div');
      row2.style.cssText = 'display:flex; gap:4px; justify-content:space-between;';

      const toAnim = document.createElement('button');
      toAnim.className = 'sm';
      toAnim.textContent = 'Sang Anim';
      toAnim.title = 'Gửi ảnh này sang Tab 4 để làm nhân vật tạo Animation';
      toAnim.addEventListener('click', async () => {
        const resp = await ctx.bridgeFetch(im.url);
        const blob = await resp.blob();
        const file = new File([blob], `asset_anim_${Date.now()}.png`, { type: 'image/png' });
        await ctx.sendToAnimTab(file);
        ctx.switchTab('tab-anim');
      });

      const toStrict = document.createElement('button');
      toStrict.className = 'sm';
      toStrict.textContent = 'Sửa vùng';
      toStrict.title = 'Gửi sang Tab 2 (Sửa vùng Strict) để chỉnh sửa chi tiết';
      toStrict.addEventListener('click', async () => {
        const resp = await ctx.bridgeFetch(im.url);
        const blob = await resp.blob();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        await ctx.sendToStrictTab(bytes, `Asset ${im.index + 1}`);
        ctx.switchTab('tab-strict');
      });

      row2.append(toAnim, toStrict);

      cap.append(row1, row2);
      fig.append(img, cap);
      gallery.append(fig);
    }
  }
}
