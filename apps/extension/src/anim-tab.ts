/**
 * anim-tab.ts: Xử lý tương tác Tab Animation Loop (Frame-by-frame & Video extraction).
 */

import { openLightbox, showToast } from './ui-helpers';

export interface BridgeJobResult {
  id: string;
  state: string;
  images?: Array<{ index: number; url: string; file_path?: string }>;
  frames?: Array<{ index: number; url: string; file_path?: string }>;
  metrics?: Record<string, unknown>;
  error?: string | null;
}

export interface AnimTabContext {
  bridgeFetch: (path: string, init?: RequestInit) => Promise<Response>;
  waitJob: (id: string) => Promise<BridgeJobResult>;
  log: (level: 'info' | 'warn' | 'error', msg: string, jobId?: string) => void;
  getBridgeUrl: () => string;
  getStrictLastResultBytes: () => Uint8Array | null;
}

const ANIM_PROMPT_IDEAS: Array<{ label: string; prompt: string }> = [
  { label: '💨 Idle Thở nhẹ', prompt: 'subtle idle breathing animation, gentle chest rise and fall, slight hair and cape sway, seamless loop' },
  { label: '🚶 Đi bộ (Walk)', prompt: 'smooth side-view walk cycle animation, balanced arm swing and leg stride, consistent character proportions, seamless loop' },
  { label: '✨ Lơ lửng phép', prompt: 'magical floating idle loop, gentle vertical bobbing motion, glowing aura particles around hands, seamless loop' },
  { label: '⚔️ Thủ thế chiến đấu', prompt: 'combat ready stance loop, rhythmic knee bounce, weapon held steady with subtle energy shimmer, seamless loop' },
];

export function initAnimTab(ctx: AnimTabContext): { setCharacterFile: (file: File) => Promise<void> } {
  const $ = <T extends HTMLElement>(id: string) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Không tìm thấy phần tử #${id}`);
    return el as T;
  };

  let charRef: { name: string; mime: string; base64: string; dataUrl: string } | null = null;
  let currentAnimJobId: string | null = null;
  let loadedFrames: HTMLImageElement[] = [];
  let isPlaying = true;
  let currentFrameIdx = 0;
  let lastFrameTime = 0;
  let animReqId: number | null = null;

  const canvas = $<HTMLCanvasElement>('anim-preview-canvas');
  const previewCtx = canvas.getContext('2d')!;

  function renderCharPreview(): void {
    const box = $('anim-ref-preview');
    box.replaceChildren();
    if (!charRef) {
      const sp = document.createElement('span');
      sp.className = 'card-sub';
      sp.style.fontSize = '12px';
      sp.textContent = 'Chưa chọn ảnh nhân vật (có thể kéo thả ảnh vào khung này).';
      box.append(sp);
      return;
    }

    const ref = charRef;
    const img = document.createElement('img');
    img.src = ref.dataUrl;
    img.style.cssText = 'width:52px; height:52px; object-fit:contain; border-radius:6px; border:1px solid var(--border); background:#070a10; cursor:zoom-in;';
    img.addEventListener('click', () => {
      openLightbox({ src: ref.dataUrl, title: ref.name, subtitle: 'Nhân vật gốc Animation' });
    });

    const info = document.createElement('div');
    info.style.cssText = 'font-size:12px; display:flex; flex-direction:column; min-width:0; flex:1;';
    const nameEl = document.createElement('strong');
    nameEl.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
    nameEl.textContent = ref.name;
    const mimeEl = document.createElement('span');
    mimeEl.className = 'card-sub';
    mimeEl.style.margin = '0';
    mimeEl.textContent = ref.mime;
    info.append(nameEl, mimeEl);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'sm danger';
    clearBtn.textContent = 'Bỏ chọn';
    clearBtn.addEventListener('click', () => {
      charRef = null;
      renderCharPreview();
    });

    box.append(img, info, clearBtn);
  }

  async function setCharacterFile(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      showToast('Vui lòng chọn tệp hình ảnh hợp lệ.', 'warn');
      return;
    }
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let j = 0; j < bytes.length; j += chunk) {
      binary += String.fromCharCode(...bytes.subarray(j, j + chunk));
    }
    const b64 = btoa(binary);
    charRef = {
      name: file.name,
      mime: file.type || 'image/png',
      base64: b64,
      dataUrl: `data:${file.type || 'image/png'};base64,${b64}`,
    };
    renderCharPreview();
  }

  $('anim-ref-input').addEventListener('change', async () => {
    const input = $<HTMLInputElement>('anim-ref-input');
    const f = input.files?.[0];
    if (f) {
      await setCharacterFile(f);
      showToast(`Đã nạp nhân vật: ${f.name}`, 'ok', 2000);
    }
    input.value = '';
  });

  const charDropZone = document.getElementById('anim-char-drop') ?? $('anim-ref-preview');
  charDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    charDropZone.classList.add('dragover');
  });
  charDropZone.addEventListener('dragleave', () => charDropZone.classList.remove('dragover'));
  charDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    charDropZone.classList.remove('dragover');
    const f = e.dataTransfer?.files?.[0];
    if (f) void setCharacterFile(f).then(() => showToast(`Đã nạp nhân vật: ${f.name}`, 'ok', 2000));
  });

  // Gợi ý prompt chuyển động nhanh
  const ideasHost = document.getElementById('anim-quick-ideas');
  if (ideasHost) {
    for (const item of ANIM_PROMPT_IDEAS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'preset-chip';
      chip.textContent = item.label;
      chip.title = item.prompt;
      chip.addEventListener('click', () => {
        $<HTMLTextAreaElement>('anim-prompt').value = item.prompt;
        $<HTMLTextAreaElement>('anim-prompt').focus();
      });
      ideasHost.append(chip);
    }
  }

  // Pixel-art crisp mode toggle
  const pixelCheck = document.getElementById('anim-pixelated') as HTMLInputElement | null;
  pixelCheck?.addEventListener('change', () => {
    canvas.style.imageRendering = pixelCheck.checked ? 'pixelated' : 'auto';
    drawFrame(currentFrameIdx);
  });

  // Lấy ảnh từ Tab Sửa vùng (kết quả vừa sửa)
  $('anim-use-strict-result').addEventListener('click', async () => {
    const bytes = ctx.getStrictLastResultBytes();
    if (!bytes) {
      showToast('Tab Sửa vùng chưa có ảnh kết quả nào để lấy.', 'warn');
      return;
    }
    const file = new File([bytes as BlobPart], `strict_result_${Date.now()}.png`, { type: 'image/png' });
    await setCharacterFile(file);
    showToast('Đã nạp ảnh kết quả từ tab Sửa vùng!', 'ok');
  });

  function setStatus(text: string): void {
    $('anim-status').textContent = text;
  }

  // Animation Loop Render
  function drawFrame(idx: number): void {
    if (loadedFrames.length === 0) return;
    const n = loadedFrames.length;
    idx = ((idx % n) + n) % n;
    currentFrameIdx = idx;

    canvas.width = loadedFrames[0]!.naturalWidth || 256;
    canvas.height = loadedFrames[0]!.naturalHeight || 256;
    previewCtx.imageSmoothingEnabled = !(pixelCheck?.checked ?? false);

    previewCtx.clearRect(0, 0, canvas.width, canvas.height);

    // Onion Skin: Vẽ frame trước mờ 35%
    const onionChecked = $<HTMLInputElement>('anim-onion').checked;
    if (onionChecked && n > 1) {
      const prevIdx = (idx - 1 + n) % n;
      previewCtx.globalAlpha = 0.35;
      previewCtx.drawImage(loadedFrames[prevIdx]!, 0, 0);
      previewCtx.globalAlpha = 1.0;
    }

    // Vẽ frame hiện tại
    previewCtx.drawImage(loadedFrames[idx]!, 0, 0);

    $('anim-curr-frame').textContent = String(idx + 1);
    $<HTMLInputElement>('anim-scrub').value = String(idx);

    document.querySelectorAll('.film-thumb').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
    });
  }

  function startAnimationLoop(): void {
    if (animReqId) cancelAnimationFrame(animReqId);

    const loop = (timestamp: number) => {
      const fps = Math.max(1, Number($<HTMLInputElement>('anim-fps').value) || 12);
      const interval = 1000 / fps;

      if (isPlaying && loadedFrames.length > 0) {
        if (!lastFrameTime) lastFrameTime = timestamp;
        const delta = timestamp - lastFrameTime;
        if (delta >= interval) {
          drawFrame(currentFrameIdx + 1);
          lastFrameTime = timestamp - (delta % interval);
        }
      }
      animReqId = requestAnimationFrame(loop);
    };

    animReqId = requestAnimationFrame(loop);
  }

  $('anim-play-toggle').addEventListener('click', () => {
    isPlaying = !isPlaying;
    $('anim-play-toggle').textContent = isPlaying ? '⏸ Tạm dừng' : '▶ Phát tiếp';
  });

  $<HTMLInputElement>('anim-scrub').addEventListener('input', () => {
    isPlaying = false;
    $('anim-play-toggle').textContent = '▶ Phát tiếp';
    const idx = Number($<HTMLInputElement>('anim-scrub').value);
    selectedIdx = idx;
    drawFrame(idx);
    updateEditButtons();
  });

  let serverImgs: HTMLImageElement[] = [];
  let order: number[] = [];
  let dirty = false;
  let selectedIdx = 0;

  function updateEditButtons(): void {
    $<HTMLButtonElement>('anim-frame-apply').disabled = !dirty || !currentAnimJobId;
    $<HTMLButtonElement>('anim-frame-del').disabled = order.length <= 2;
    $<HTMLButtonElement>('anim-frame-left').disabled = selectedIdx <= 0;
    $<HTMLButtonElement>('anim-frame-right').disabled = selectedIdx >= order.length - 1;
  }

  function renderCompare(): void {
    const first = $<HTMLImageElement>('anim-cmp-first');
    const last = $<HTMLImageElement>('anim-cmp-last');
    if (order.length < 2) return;
    first.src = serverImgs[order[0]!]?.src ?? '';
    last.src = serverImgs[order[order.length - 1]!]?.src ?? '';
  }

  function renderStrip(): void {
    loadedFrames = order.map((i) => serverImgs[i]!);
    $('anim-total-frames').textContent = String(order.length);
    const scrub = $<HTMLInputElement>('anim-scrub');
    scrub.max = String(Math.max(0, order.length - 1));
    selectedIdx = Math.min(selectedIdx, order.length - 1);
    scrub.value = String(selectedIdx);

    const filmstrip = $('anim-filmstrip');
    filmstrip.replaceChildren();
    order.forEach((srvIdx, pos) => {
      const thumb = document.createElement('div');
      thumb.className = 'film-thumb';
      if (pos === selectedIdx) thumb.classList.add('active');

      const tImg = document.createElement('img');
      tImg.src = serverImgs[srvIdx]!.src;

      const fNum = document.createElement('span');
      fNum.className = 'f-num';
      fNum.textContent = String(pos + 1);

      thumb.append(tImg, fNum);
      thumb.addEventListener('click', () => {
        isPlaying = false;
        $('anim-play-toggle').textContent = '▶ Phát tiếp';
        selectedIdx = pos;
        drawFrame(pos);
        updateEditButtons();
      });
      filmstrip.append(thumb);
    });
    renderCompare();
    updateEditButtons();
    if (loadedFrames.length > 0) drawFrame(Math.min(currentFrameIdx, loadedFrames.length - 1));
  }

  async function loadFramesIntoPlayer(frameUrls: string[], metrics?: Record<string, unknown>): Promise<void> {
    const bust = Date.now();
    serverImgs = [];
    for (const url of frameUrls) {
      const img = new Image();
      img.src = `${ctx.getBridgeUrl()}${url}${url.includes('?') ? '&' : '?'}v=${bust}`;
      await new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve;
      });
      serverImgs.push(img);
    }
    order = serverImgs.map((_, i) => i);
    dirty = false;
    selectedIdx = 0;
    currentFrameIdx = 0;
    renderStrip();
    $('anim-edit-box').hidden = false;

    if (metrics) {
      const badge = $('anim-loop-score-badge');
      badge.style.display = 'block';
      const score = Math.round(Number(metrics.loop_score ?? 1) * 100);
      $('anim-score-val').textContent = `${score}% (${metrics.seamless ? 'Mượt' : 'Khựng nhẹ'})`;
      badge.style.borderColor = metrics.seamless ? '#10b981' : '#f59e0b';
    }

    $<HTMLButtonElement>('anim-dl-sheet').disabled = false;
    $<HTMLButtonElement>('anim-dl-json').disabled = false;
    $<HTMLButtonElement>('anim-dl-gif').disabled = false;
    $<HTMLButtonElement>('anim-dl-webp').disabled = false;
    $<HTMLButtonElement>('anim-dl-zip').disabled = false;

    isPlaying = true;
    $('anim-play-toggle').textContent = '⏸ Tạm dừng';
    startAnimationLoop();
  }

  $('anim-dl-sheet').onclick = () => {
    if (currentAnimJobId) window.open(`${ctx.getBridgeUrl()}/animations/${currentAnimJobId}/sheet`, '_blank');
  };
  $('anim-dl-json').onclick = () => {
    if (currentAnimJobId) window.open(`${ctx.getBridgeUrl()}/animations/${currentAnimJobId}/sheet?meta=true`, '_blank');
  };
  $('anim-dl-gif').onclick = () => {
    if (currentAnimJobId) window.open(`${ctx.getBridgeUrl()}/animations/${currentAnimJobId}/gif`, '_blank');
  };
  $('anim-dl-webp').onclick = () => {
    if (currentAnimJobId) window.open(`${ctx.getBridgeUrl()}/animations/${currentAnimJobId}/webp`, '_blank');
  };
  $('anim-dl-zip').onclick = () => {
    if (currentAnimJobId) window.open(`${ctx.getBridgeUrl()}/animations/${currentAnimJobId}/zip`, '_blank');
  };

  function markDirty(): void {
    dirty = true;
    renderStrip();
  }
  $('anim-frame-del').addEventListener('click', () => {
    if (order.length <= 2) return;
    order.splice(selectedIdx, 1);
    markDirty();
  });
  $('anim-frame-left').addEventListener('click', () => {
    if (selectedIdx <= 0) return;
    const [a, b] = [order[selectedIdx - 1]!, order[selectedIdx]!];
    order[selectedIdx - 1] = b;
    order[selectedIdx] = a;
    selectedIdx -= 1;
    currentFrameIdx = selectedIdx;
    markDirty();
  });
  $('anim-frame-right').addEventListener('click', () => {
    if (selectedIdx >= order.length - 1) return;
    const [a, b] = [order[selectedIdx]!, order[selectedIdx + 1]!];
    order[selectedIdx] = b;
    order[selectedIdx + 1] = a;
    selectedIdx += 1;
    currentFrameIdx = selectedIdx;
    markDirty();
  });
  $('anim-frame-reset').addEventListener('click', () => {
    order = serverImgs.map((_, i) => i);
    dirty = false;
    selectedIdx = 0;
    currentFrameIdx = 0;
    renderStrip();
  });
  $('anim-frame-apply').addEventListener('click', async () => {
    if (!currentAnimJobId) return;
    const btn = $<HTMLButtonElement>('anim-frame-apply');
    try {
      btn.disabled = true;
      setStatus('Đang áp dụng chuỗi frame mới...');
      const fps = Number($<HTMLInputElement>('anim-fps').value) || 12;
      const loopBlend = $<HTMLInputElement>('anim-loop-blend').checked;
      const res = await ctx.bridgeFetch(`/animations/${currentAnimJobId}/frames/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order, fps, loop_blend: loopBlend }),
      });
      if (!res.ok) throw new Error(`Áp dụng thất bại: ${await res.text()}`);
      const updated = (await res.json()) as BridgeJobResult;
      await loadFramesIntoPlayer((updated.frames || []).map((f) => f.url), updated.metrics);
      setStatus('Đã cập nhật chuỗi frame. Các file tải về đã được đóng gói lại.');
      showToast('Đã đóng gói lại chuỗi frame!', 'ok');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(msg);
      showToast(msg, 'error');
      ctx.log('error', msg);
    } finally {
      updateEditButtons();
    }
  });

  // Nút Generate Animation Loop
  $('anim-generate').addEventListener('click', async () => {
    const btn = $<HTMLButtonElement>('anim-generate');
    try {
      const prompt = $<HTMLTextAreaElement>('anim-prompt').value.trim();
      if (!prompt) {
        setStatus('Hãy nhập mô tả chuyển động animation.');
        showToast('Hãy nhập mô tả chuyển động cho Animation.', 'warn');
        $<HTMLTextAreaElement>('anim-prompt').focus();
        return;
      }
      const mode = $<HTMLSelectElement>('anim-mode').value;
      const frames = Number($<HTMLSelectElement>('anim-frames').value) || 12;
      const fps = Number($<HTMLInputElement>('anim-fps').value) || 12;
      const sizeVal = $<HTMLSelectElement>('anim-size').value;
      const [w, h] = sizeVal.split('x').map(Number) as [number, number];
      const transparent = $<HTMLInputElement>('anim-transparent').checked;

      btn.disabled = true;
      setStatus('Đang gửi yêu cầu tạo animation...');

      const body = {
        prompt,
        mode,
        frames,
        fps,
        width: w || 512,
        height: h || 512,
        transparent,
        loop_blend: $<HTMLInputElement>('anim-loop-blend').checked,
        refs: charRef ? [{ name: charRef.name, mime: charRef.mime, base64: charRef.base64 }] : [],
        keyframe: charRef ? { name: charRef.name, mime: charRef.mime, base64: charRef.base64 } : null,
      };

      const res = await ctx.bridgeFetch('/animations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`Bridge từ chối (HTTP ${res.status}): ${await res.text()}`);
      }

      const created = (await res.json()) as { id: string };
      currentAnimJobId = created.id;
      setStatus(`Job #${created.id.slice(0, 8)} đã tạo. Đang xử lý...`);

      const job = await ctx.waitJob(created.id);
      if (job.state === 'error' || !job.frames?.length) {
        throw new Error(job.error || 'Flow không trả chuỗi frame nào.');
      }

      setStatus(`Hoàn tất Animation: ${job.frames.length} frame!`);
      showToast(`Hoàn tất Animation (${job.frames.length} frames)!`, 'ok');
      const urls = job.frames.map((f) => f.url);
      await loadFramesIntoPlayer(urls, job.metrics);

      $('anim-reframe-box').hidden = mode !== 'video';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(msg);
      showToast(msg, 'error');
      ctx.log('error', msg);
    } finally {
      btn.disabled = false;
    }
  });

  // Nút Cắt lại Frame (Reframe)
  $('anim-reframe-btn').addEventListener('click', async () => {
    if (!currentAnimJobId) return;
    const btn = $<HTMLButtonElement>('anim-reframe-btn');
    try {
      btn.disabled = true;
      setStatus('Đang trích lại frame với offset mới...');

      const frames = Number($<HTMLSelectElement>('anim-frames').value) || 12;
      const fps = Number($<HTMLInputElement>('anim-fps').value) || 12;
      const offset = Number($<HTMLInputElement>('reframe-offset').value) || 0;
      const transparent = $<HTMLInputElement>('anim-transparent').checked;

      const res = await ctx.bridgeFetch(`/animations/${currentAnimJobId}/reframe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frames, fps, offset, transparent }),
      });

      if (!res.ok) throw new Error(`Reframe thất bại: ${await res.text()}`);

      const updated = (await res.json()) as BridgeJobResult;
      const urls = (updated.frames || []).map((f) => f.url);
      await loadFramesIntoPlayer(urls, updated.metrics);
      setStatus('Đã cập nhật frame mới thành công!');
      showToast('Đã cắt lại frame thành công (0 token)!', 'ok');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(msg);
      showToast(msg, 'error');
      ctx.log('error', msg);
    } finally {
      btn.disabled = false;
    }
  });

  return { setCharacterFile };
}
