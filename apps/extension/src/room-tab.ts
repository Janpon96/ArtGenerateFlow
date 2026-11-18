/**
 * room-tab.ts: Tab "BG Room" (trong nhóm Image).
 * Nạp một ảnh phòng chibi isometric, bấm Generate để nhận các ảnh nền illust 2D nhìn từ giữa phòng.
 */
import { readSourceImage } from './source-image';
import { buildRoomPrompts, MAX_ROOM_VIEWS, parseObjects, ROOM_VIEW_PRESETS } from './room-prompts';
import { openLightbox, showToast } from './ui-helpers';

interface RoomImage { index: number; url: string; label?: string; order?: number }
interface RoomJob { id: string; state: string; count?: number; labels?: string[]; steps?: Array<{ msg: string }>; images?: RoomImage[]; error?: string | null }

export interface RoomTabContext {
  bridgeFetch: (path: string, init?: RequestInit) => Promise<Response>;
  waitJob: (id: string, onProgress?: (job: RoomJob) => void) => Promise<RoomJob>;
  log: (level: 'info' | 'warn' | 'error', msg: string, jobId?: string) => void;
  switchTab: (tabId: string) => void;
  getBridgeUrl: () => string;
  getRemoveWatermark: () => boolean;
  addAsReference: (file: File) => Promise<void>;
  sendToStrictTab: (bytes: Uint8Array, label: string) => Promise<void>;
}

export function initRoomTab(ctx: RoomTabContext): void {
  const $ = <T extends HTMLElement>(id: string) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Không tìm thấy phần tử #${id}`);
    return el as T;
  };

  let room: { name: string; mime: string; base64: string } | null = null;

  const setStatus = (text: string): void => { $('room-status').textContent = text; };
  const setSourceInfo = (text: string, isError = false): void => {
    const el = $('room-source-info');
    el.textContent = text;
    el.style.color = isError ? 'var(--danger, #ef4444)' : 'var(--text-muted)';
  };

  // ---- Danh sách góc nhìn ----
  const viewBox = $('room-views');
  const DEFAULT_ON = new Set(['corner', 'left-wall', 'right-wall']);
  for (const view of ROOM_VIEW_PRESETS) {
    const label = document.createElement('label');
    const isChecked = DEFAULT_ON.has(view.id);
    label.className = `check-chip${isChecked ? ' checked' : ''}`;
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = view.id;
    box.checked = isChecked;
    box.addEventListener('change', () => {
      label.classList.toggle('checked', box.checked);
      updateCount();
    });
    const span = document.createElement('span');
    span.textContent = view.label;
    label.append(box, span);
    viewBox.append(label);
  }

  function syncChipClasses(): void {
    viewBox.querySelectorAll<HTMLLabelElement>('label.check-chip').forEach((lbl) => {
      const inp = lbl.querySelector('input');
      lbl.classList.toggle('checked', Boolean(inp?.checked));
    });
  }

  document.getElementById('room-select-default')?.addEventListener('click', () => {
    viewBox.querySelectorAll<HTMLInputElement>('input').forEach((b) => {
      b.checked = DEFAULT_ON.has(b.value);
    });
    syncChipClasses();
    updateCount();
  });

  document.getElementById('room-select-all')?.addEventListener('click', () => {
    viewBox.querySelectorAll<HTMLInputElement>('input').forEach((b) => {
      b.checked = true;
    });
    syncChipClasses();
    updateCount();
  });

  document.getElementById('room-clear')?.addEventListener('click', () => {
    viewBox.querySelectorAll<HTMLInputElement>('input').forEach((b) => {
      b.checked = false;
    });
    syncChipClasses();
    updateCount();
  });

  function selectedViewIds(): string[] {
    return [...viewBox.querySelectorAll<HTMLInputElement>('input:checked')].map((b) => b.value);
  }

  function currentPrompts() {
    return buildRoomPrompts({
      viewIds: selectedViewIds(),
      objects: parseObjects($<HTMLInputElement>('room-objects').value),
      artStyle: $<HTMLInputElement>('room-style').value,
      notes: $<HTMLInputElement>('room-notes').value,
    });
  }

  function updateCount(): void {
    const wanted = selectedViewIds().length + parseObjects($<HTMLInputElement>('room-objects').value).length;
    const n = Math.min(wanted, MAX_ROOM_VIEWS);
    $('room-count').textContent = wanted > MAX_ROOM_VIEWS
      ? `Sẽ tạo ${n} ảnh (đã chọn ${wanted}, tối đa ${MAX_ROOM_VIEWS} ảnh mỗi lần)`
      : `Sẽ tạo ${n} ảnh`;
  }
  $('room-objects').addEventListener('input', updateCount);
  updateCount();

  // ---- Nạp ảnh phòng ----
  async function loadRoomFile(file: File): Promise<void> {
    setSourceInfo(`Đang đọc ${file.name}...`);
    try {
      const img = await readSourceImage(file);
      room = { name: img.name, mime: img.mime, base64: img.base64 };
      const preview = $<HTMLImageElement>('room-preview');
      preview.src = img.dataUrl;
      preview.hidden = false;
      $('room-drop-hint').hidden = true;
      setSourceInfo(`Đã nạp ${img.summary} (bấm khung để đổi ảnh).`);
      setStatus('');
      showToast(`Đã nạp ảnh phòng: ${file.name}`, 'ok', 2200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSourceInfo(msg, true);
      setStatus(msg);
      showToast(msg, 'error');
    }
  }

  $<HTMLInputElement>('room-input').addEventListener('change', (ev) => {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void loadRoomFile(file);
  });
  const drop = $('room-drop');
  drop.addEventListener('click', () => $<HTMLInputElement>('room-input').click());
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('dragover');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) void loadRoomFile(file);
  });

  function readSize(): { width: number; height: number } {
    const [w, h] = $<HTMLSelectElement>('room-size').value.split('x').map(Number) as [number, number];
    return { width: w || 0, height: h || 0 };
  }

  // ---- Generate ----
  $('room-generate').addEventListener('click', async () => {
    const btn = $<HTMLButtonElement>('room-generate');
    try {
      if (!room) {
        setStatus('Hãy nạp ảnh phòng isometric trước.');
        showToast('Hãy nạp ảnh phòng isometric trước.', 'warn');
        return;
      }
      const prompts = currentPrompts();
      if (prompts.length === 0) {
        setStatus('Hãy chọn ít nhất một góc nhìn hoặc nhập một vật thể.');
        showToast('Hãy chọn ít nhất 1 góc nhìn.', 'warn');
        return;
      }
      const model = $<HTMLSelectElement>('room-model').value;
      if (!model) {
        setStatus('Chưa có model (bridge server chưa kết nối?).');
        showToast('Chưa kết nối được Bridge Server.', 'error');
        return;
      }
      const size = readSize();

      btn.disabled = true;
      setStatus(`Đang gửi ${prompts.length} góc nhìn tới bridge...`);
      const res = await ctx.bridgeFetch('/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `BG Room: ${prompts.map((p) => p.label).join(', ')}`,
          prompts: prompts.map((p) => p.prompt),
          labels: prompts.map((p) => p.label),
          model,
          aspect_ratio: size.height > size.width ? '9:16' : '16:9',
          ...size,
          remove_watermark: ctx.getRemoveWatermark(),
          references: [room],
        }),
      });
      if (!res.ok) throw new Error(`Bridge từ chối (HTTP ${res.status}): ${await res.text()}`);
      const created = (await res.json()) as RoomJob;
      created.count ??= prompts.length;
      created.labels ??= prompts.map((p) => p.label);
      renderGallery(created, prompts.map((p) => p.label));
      setStatus(`Job #${created.id.slice(0, 8)} đang chạy (${prompts.length} góc nhìn)...`);
      const job = await ctx.waitJob(created.id, (liveJob) => renderGallery(liveJob, prompts.map((p) => p.label)));
      renderGallery(job, prompts.map((p) => p.label));
      if (!job.images?.length) throw new Error(job.error || 'Flow không trả ảnh nào.');
      setStatus(job.images.length < prompts.length
        ? `Xong ${job.images.length}/${prompts.length} ảnh. Một số góc nhìn bị lỗi, xem Console.`
        : `Hoàn tất ${job.images.length} ảnh nền.`);
      showToast(`Hoàn tất ${job.images.length} ảnh BG Room!`, 'ok');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(msg);
      showToast(msg, 'error');
      ctx.log('error', msg);
    } finally {
      btn.disabled = false;
    }
  });

  function renderGallery(job: RoomJob, fallbackLabels: string[] = []): void {
    const gallery = $('room-gallery');
    gallery.className = 'jobs-grid-library';
    gallery.replaceChildren();
    const zip = $<HTMLButtonElement>('room-download-zip');
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
            title: `BG Room • ${label}`,
            subtitle: `Góc ${slotOrder}/${totalSlots} • Job #${job.id.slice(0, 8)}`,
            downloadUrl: dlUrl,
            downloadName: `room_${job.id.slice(0, 8)}_${slotOrder}.png`,
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
        t1.textContent = `Đang tạo góc ${slotOrder}/${totalSlots}...`;
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
        t1.textContent = `Góc ${slotOrder}/${totalSlots} lỗi`;
        const t2 = document.createElement('div');
        t2.className = 'slot-placeholder-sub';
        t2.textContent = job.error || 'Không tạo được góc nhìn này.';
        thumb.append(tag, t1, t2);
      }
      card.append(thumb);

      if (im) {
        const body = document.createElement('div');
        body.className = 'job-slot-body';
        const cap = document.createElement('div');
        cap.className = 'job-slot-actions';
        const dl = document.createElement('a');
        dl.textContent = 'Tải về';
        dl.href = `${ctx.getBridgeUrl()}${im.url}?download=true`;

        const fetchBlob = async (): Promise<Blob> => {
          const resp = await ctx.bridgeFetch(im.url);
          if (!resp.ok) throw new Error(`Không tải được ảnh (HTTP ${resp.status})`);
          return resp.blob();
        };
        const guard = (fn: () => Promise<void>) => () => void fn().catch((e) => setStatus(e instanceof Error ? e.message : String(e)));

        const toRef = document.createElement('button');
        toRef.type = 'button';
        toRef.textContent = 'Dùng làm ref';
        toRef.title = 'Đưa ảnh này vào bộ ảnh tham chiếu của tab Phối ảnh';
        toRef.addEventListener('click', guard(async () => {
          const blob = await fetchBlob();
          await ctx.addAsReference(new File([blob], `room_${job.id.slice(0, 8)}_${im.index + 1}.png`, { type: blob.type || 'image/png' }));
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

        cap.append(dl, toRef, toStrict);
        body.append(cap);
        card.append(body);
      }
      gallery.append(card);
    }
  }
}
