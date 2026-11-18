/**
 * camera-tab.ts: Tab "Camera Image" (trong nhóm Image).
 * Nạp một ảnh illust, chọn các góc máy, bấm Generate để nhận cùng cảnh đó vẽ lại từ từng góc máy.
 */
import {
  aspectForImage, buildCameraPrompts, CAMERA_GROUPS, CAMERA_OPTIONS, MAX_CAMERA_SHOTS, parseCustomCameras,
  type CameraOption,
} from './camera-prompts';
import { readSourceImage } from './source-image';
import { openLightbox, showToast } from './ui-helpers';

interface CamImage { index: number; url: string; label?: string; order?: number }
interface CamJob { id: string; state: string; count?: number; labels?: string[]; steps?: Array<{ msg: string }>; images?: CamImage[]; error?: string | null }

export interface CameraTabContext {
  bridgeFetch: (path: string, init?: RequestInit) => Promise<Response>;
  waitJob: (id: string, onProgress?: (job: CamJob) => void) => Promise<CamJob>;
  log: (level: 'info' | 'warn' | 'error', msg: string, jobId?: string) => void;
  switchTab: (tabId: string) => void;
  getBridgeUrl: () => string;
  getRemoveWatermark: () => boolean;
  addAsReference: (file: File) => Promise<void>;
  sendToStrictTab: (bytes: Uint8Array, label: string) => Promise<void>;
}

export function initCameraTab(ctx: CameraTabContext): void {
  const $ = <T extends HTMLElement>(id: string) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Không tìm thấy phần tử #${id}`);
    return el as T;
  };

  let source: { name: string; mime: string; base64: string; width: number; height: number } | null = null;

  const setStatus = (text: string): void => { $('cam-status').textContent = text; };
  const setSourceInfo = (text: string, isError = false): void => {
    const el = $('cam-source-info');
    el.textContent = text;
    el.style.color = isError ? 'var(--danger, #ef4444)' : 'var(--text-muted)';
  };

  // ---- Danh sách góc máy, chia nhóm ----
  const optionBox = $('cam-options');
  const DEFAULT_ON = new Set(['low']);
  const POPULAR_SET = new Set(['low', 'high', 'close-up', 'wide']);
  for (const group of Object.keys(CAMERA_GROUPS) as CameraOption['group'][]) {
    const title = document.createElement('div');
    title.className = 'check-group-title';
    title.textContent = CAMERA_GROUPS[group];
    optionBox.append(title);
    for (const opt of CAMERA_OPTIONS.filter((o) => o.group === group)) {
      const isChecked = DEFAULT_ON.has(opt.id);
      const label = document.createElement('label');
      label.className = `check-chip${isChecked ? ' checked' : ''}`;
      label.title = opt.camera;
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = opt.id;
      box.checked = isChecked;
      box.addEventListener('change', () => {
        label.classList.toggle('checked', box.checked);
        updateCount();
      });
      const span = document.createElement('span');
      span.textContent = opt.label;
      label.append(box, span);
      optionBox.append(label);
    }
  }

  function syncChipClasses(): void {
    optionBox.querySelectorAll<HTMLLabelElement>('label.check-chip').forEach((lbl) => {
      const inp = lbl.querySelector('input');
      lbl.classList.toggle('checked', Boolean(inp?.checked));
    });
  }

  const selectedIds = (): string[] =>
    [...optionBox.querySelectorAll<HTMLInputElement>('input:checked')].map((b) => b.value);
  const customList = (): string[] => parseCustomCameras($<HTMLTextAreaElement>('cam-custom').value);

  function updateCount(): void {
    const wanted = selectedIds().length + customList().length;
    const n = Math.min(wanted, MAX_CAMERA_SHOTS);
    $('cam-count').textContent = wanted > MAX_CAMERA_SHOTS
      ? `Sẽ tạo ${n} ảnh (đã chọn ${wanted}, tối đa ${MAX_CAMERA_SHOTS} ảnh mỗi lần)`
      : `Sẽ tạo ${n} ảnh`;
  }
  $('cam-custom').addEventListener('input', updateCount);

  document.getElementById('cam-select-popular')?.addEventListener('click', () => {
    optionBox.querySelectorAll<HTMLInputElement>('input').forEach((b) => {
      b.checked = POPULAR_SET.has(b.value);
    });
    syncChipClasses();
    updateCount();
  });

  $('cam-clear').addEventListener('click', () => {
    optionBox.querySelectorAll<HTMLInputElement>('input').forEach((b) => { b.checked = false; });
    syncChipClasses();
    updateCount();
  });
  updateCount();

  // ---- Nạp ảnh nguồn ----
  async function loadSource(file: File): Promise<void> {
    setSourceInfo(`Đang đọc ${file.name}...`);
    try {
      const img = await readSourceImage(file);
      source = { name: img.name, mime: img.mime, base64: img.base64, width: img.width, height: img.height };
      const preview = $<HTMLImageElement>('cam-preview');
      preview.src = img.dataUrl;
      preview.hidden = false;
      $('cam-drop-hint').hidden = true;
      setSourceInfo(`Đã nạp ${img.summary} • Tỉ lệ ${aspectForImage(img.width, img.height)}`);
      setStatus('');
      showToast(`Đã nạp ảnh nguồn: ${file.name}`, 'ok', 2200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSourceInfo(msg, true);
      setStatus(msg);
      showToast(msg, 'error');
    }
  }

  $<HTMLInputElement>('cam-input').addEventListener('change', (ev) => {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void loadSource(file);
  });
  const drop = $('cam-drop');
  drop.addEventListener('click', () => $<HTMLInputElement>('cam-input').click());
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('dragover');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) void loadSource(file);
  });

  function readOutput(src: { width: number; height: number }): { width: number; height: number; aspect_ratio: string } {
    const v = $<HTMLSelectElement>('cam-size').value;
    if (v === 'auto') return { width: 0, height: 0, aspect_ratio: aspectForImage(src.width, src.height) };
    const [w, h] = v.split('x').map(Number) as [number, number];
    return { width: w, height: h, aspect_ratio: aspectForImage(w, h) };
  }

  // ---- Generate ----
  $('cam-generate').addEventListener('click', async () => {
    const btn = $<HTMLButtonElement>('cam-generate');
    try {
      if (!source) {
        setStatus('Hãy nạp ảnh illust trước.');
        showToast('Hãy nạp ảnh illust nguồn trước.', 'warn');
        return;
      }
      const prompts = buildCameraPrompts({
        optionIds: selectedIds(),
        custom: customList(),
        artStyle: $<HTMLInputElement>('cam-style').value,
        notes: $<HTMLTextAreaElement>('cam-notes').value,
        keepPose: $<HTMLInputElement>('cam-keep-pose').checked,
      });
      if (prompts.length === 0) {
        setStatus('Hãy chọn ít nhất một góc máy hoặc tự nhập một góc máy.');
        showToast('Hãy chọn ít nhất 1 góc máy.', 'warn');
        return;
      }
      const model = $<HTMLSelectElement>('cam-model').value;
      if (!model) {
        setStatus('Chưa có model (bridge server chưa kết nối?).');
        showToast('Chưa kết nối được Bridge Server.', 'error');
        return;
      }

      btn.disabled = true;
      setStatus(`Đang gửi ${prompts.length} góc máy tới bridge...`);
      const res = await ctx.bridgeFetch('/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Camera Image: ${prompts.map((p) => p.label).join(', ')}`,
          prompts: prompts.map((p) => p.prompt),
          labels: prompts.map((p) => p.label),
          model,
          ...readOutput(source),
          remove_watermark: ctx.getRemoveWatermark(),
          references: [{ name: source.name, mime: source.mime, base64: source.base64 }],
        }),
      });
      if (!res.ok) throw new Error(`Bridge từ chối (HTTP ${res.status}): ${await res.text()}`);
      const created = (await res.json()) as CamJob;
      created.count ??= prompts.length;
      created.labels ??= prompts.map((p) => p.label);
      renderGallery(created, prompts.map((p) => p.label));
      setStatus(`Job #${created.id.slice(0, 8)} đang chạy (${prompts.length} góc máy)...`);
      const job = await ctx.waitJob(created.id, (liveJob) => renderGallery(liveJob, prompts.map((p) => p.label)));
      renderGallery(job, prompts.map((p) => p.label));
      if (!job.images?.length) throw new Error(job.error || 'Flow không trả ảnh nào.');
      setStatus(job.images.length < prompts.length
        ? `Xong ${job.images.length}/${prompts.length} ảnh. Một số góc máy bị lỗi, xem Console.`
        : `Hoàn tất ${job.images.length} ảnh.`);
      showToast(`Hoàn tất ${job.images.length} góc máy!`, 'ok');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(msg);
      showToast(msg, 'error');
      ctx.log('error', msg);
    } finally {
      btn.disabled = false;
    }
  });

  function renderGallery(job: CamJob, fallbackLabels: string[] = []): void {
    const gallery = $('cam-gallery');
    gallery.className = 'jobs-grid-library';
    gallery.replaceChildren();
    const zip = $<HTMLButtonElement>('cam-download-zip');
    const images = job.images ?? [];
    zip.hidden = images.length === 0;
    zip.onclick = () => window.open(`${ctx.getBridgeUrl()}/jobs/${job.id}/zip`, '_blank');

    const labels = job.labels?.length ? job.labels : fallbackLabels;
    const totalSlots = Math.max(Number(job.count) || 1, labels.length, images.length);
    const isFinal = job.state === 'done' || job.state === 'error';
    const latestStep = job.steps?.length ? job.steps[job.steps.length - 1]!.msg : 'Đang tạo ảnh...';

    for (let slotOrder = 1; slotOrder <= totalSlots; slotOrder++) {
      const idx = slotOrder - 1;
      const im = images.find((x) => x.order === slotOrder) ?? images[idx];
      const label = im?.label || labels[idx] || `Ảnh ${slotOrder}`;

      const card = document.createElement('div');
      card.className = 'job-slot-card';
      if (!im && !isFinal) card.classList.add('is-generating');
      if (!im && isFinal) card.classList.add('is-error');

      const thumb = document.createElement('div');
      thumb.className = 'job-slot-thumb';
      const badge = document.createElement('span');
      badge.className = 'job-slot-badge';
      badge.textContent = `${slotOrder}/${totalSlots} • ${label}`;
      thumb.append(badge);

      if (im) {
        const fullUrl = `${ctx.getBridgeUrl()}${im.url}`;
        const dlUrl = `${fullUrl}?download=true`;
        const tag = document.createElement('span');
        tag.className = 'job-slot-status-tag done';
        tag.textContent = 'Hoàn tất';
        const img = document.createElement('img');
        img.src = fullUrl;
        img.alt = label;
        img.addEventListener('click', () => {
          openLightbox({
            src: fullUrl,
            title: `Camera • ${label}`,
            subtitle: `Góc máy ${slotOrder}/${totalSlots} • Job #${job.id.slice(0, 8)}`,
            downloadUrl: dlUrl,
            downloadName: `camera_${job.id.slice(0, 8)}_${slotOrder}.png`,
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
        t1.textContent = `Đang tạo góc máy ${slotOrder}/${totalSlots}...`;
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
        t1.textContent = `Góc máy ${slotOrder}/${totalSlots} lỗi`;
        const t2 = document.createElement('div');
        t2.className = 'slot-placeholder-sub';
        t2.textContent = job.error || 'Không tạo được góc máy này.';
        thumb.append(tag, t1, t2);
      }
      card.append(thumb);

      if (im) {
        const fetchBlob = async (): Promise<Blob> => {
          const resp = await ctx.bridgeFetch(im.url);
          if (!resp.ok) throw new Error(`Không tải được ảnh (HTTP ${resp.status})`);
          return resp.blob();
        };
        const guard = (fn: () => Promise<void>) => () => void fn().catch((e) => setStatus(e instanceof Error ? e.message : String(e)));

        const body = document.createElement('div');
        body.className = 'job-slot-body';
        const cap = document.createElement('div');
        cap.className = 'job-slot-actions';
        const dl = document.createElement('a');
        dl.textContent = 'Tải về';
        dl.href = `${ctx.getBridgeUrl()}${im.url}?download=true`;

        const again = document.createElement('button');
        again.type = 'button';
        again.textContent = 'Làm ảnh nguồn';
        again.title = 'Dùng ảnh này làm ảnh nguồn để đổi góc máy tiếp';
        again.addEventListener('click', guard(async () => {
          const blob = await fetchBlob();
          await loadSource(new File([blob], `camera_${job.id.slice(0, 8)}_${im.index + 1}.png`, { type: blob.type || 'image/png' }));
        }));

        const toRef = document.createElement('button');
        toRef.type = 'button';
        toRef.textContent = 'Dùng làm ref';
        toRef.title = 'Đưa ảnh này vào bộ ảnh tham chiếu của tab Phối ảnh';
        toRef.addEventListener('click', guard(async () => {
          const blob = await fetchBlob();
          await ctx.addAsReference(new File([blob], `camera_${job.id.slice(0, 8)}_${im.index + 1}.png`, { type: blob.type || 'image/png' }));
          ctx.switchTab('tab-studio');
          showToast('Đã đưa ảnh vào bộ Reference!', 'ok');
        }));

        const toStrict = document.createElement('button');
        toStrict.type = 'button';
        toStrict.textContent = 'Sửa vùng';
        toStrict.addEventListener('click', guard(async () => {
          const blob = await fetchBlob();
          await ctx.sendToStrictTab(new Uint8Array(await blob.arrayBuffer()), label);
          ctx.switchTab('tab-strict');
        }));

        cap.append(dl, again, toRef, toStrict);
        body.append(cap);
        card.append(body);
      }
      gallery.append(card);
    }
  }
}
