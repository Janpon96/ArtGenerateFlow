/**
 * room-tab.ts: Tab "BG Room" (trong nhóm Image).
 * Nạp một ảnh phòng chibi isometric, bấm Generate để nhận các ảnh nền illust 2D nhìn từ giữa phòng.
 */
import { readSourceImage } from './source-image';
import { buildRoomPrompts, MAX_ROOM_VIEWS, parseObjects, ROOM_VIEW_PRESETS } from './room-prompts';

interface RoomImage { index: number; url: string; label?: string; order?: number }
interface RoomJob { id: string; state: string; images?: RoomImage[]; error?: string | null }

export interface RoomTabContext {
  bridgeFetch: (path: string, init?: RequestInit) => Promise<Response>;
  waitJob: (id: string) => Promise<RoomJob>;
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
  /** Dòng ngay dưới khung ảnh phòng: người dùng nhìn thấy kết quả của thao tác chọn ảnh tại chỗ. */
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
    label.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:12.5px; cursor:pointer;';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = view.id;
    box.checked = DEFAULT_ON.has(view.id);
    box.style.width = 'auto';
    box.addEventListener('change', updateCount);
    label.append(box, document.createTextNode(view.label));
    viewBox.append(label);
  }

  function selectedViewIds(): string[] {
    return [...viewBox.querySelectorAll<HTMLInputElement>('input:checked')].map((b) => b.value);
  }

  function currentPrompts() {
    return buildRoomPrompts({
      viewIds: selectedViewIds(),
      objects: parseObjects($<HTMLInputElement>('room-objects').value),
      artStyle: $<HTMLInputElement>('room-style').value,
      notes: $<HTMLTextAreaElement>('room-notes').value,
    });
  }

  function updateCount(): void {
    const wanted = selectedViewIds().length + parseObjects($<HTMLInputElement>('room-objects').value).length;
    const n = Math.min(wanted, MAX_ROOM_VIEWS);
    $('room-count').textContent = wanted > MAX_ROOM_VIEWS
      ? `Sẽ tạo ${n} ảnh (đã chọn ${wanted}, tối đa ${MAX_ROOM_VIEWS} ảnh mỗi lần; phần dư bị bỏ).`
      : `Sẽ tạo ${n} ảnh.`;
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
      setSourceInfo(`Đã nạp ${img.summary}.`);
      setStatus('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSourceInfo(msg, true);
      setStatus(msg);
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
  drop.addEventListener('dragover', (e) => { e.preventDefault(); });
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
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
      if (!room) { setStatus('Hãy nạp ảnh phòng isometric trước.'); return; }
      const prompts = currentPrompts();
      if (prompts.length === 0) { setStatus('Hãy chọn ít nhất một góc nhìn hoặc nhập một vật thể.'); return; }
      const model = $<HTMLSelectElement>('room-model').value;
      if (!model) { setStatus('Chưa có model (bridge server chưa kết nối?).'); return; }
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
      setStatus(`Job #${created.id.slice(0, 8)} đang chạy: ${prompts.length} ảnh, tạo lần lượt. Xem tiến độ ở tab Hàng đợi Job.`);
      const job = await ctx.waitJob(created.id);
      if (!job.images?.length) throw new Error(job.error || 'Flow không trả ảnh nào.');
      renderGallery(job);
      setStatus(job.images.length < prompts.length
        ? `Xong ${job.images.length}/${prompts.length} ảnh. Một số góc nhìn bị lỗi, xem Console.`
        : `Hoàn tất ${job.images.length} ảnh nền.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(msg);
      ctx.log('error', msg);
    } finally {
      btn.disabled = false;
    }
  });

  function renderGallery(job: RoomJob): void {
    const gallery = $('room-gallery');
    gallery.replaceChildren();
    const zip = $<HTMLButtonElement>('room-download-zip');
    zip.hidden = false;
    zip.onclick = () => window.open(`${ctx.getBridgeUrl()}/jobs/${job.id}/zip`, '_blank');

    // Ảnh hoàn tất không theo thứ tự gửi; sắp lại theo thứ tự góc nhìn đã chọn.
    const images = [...(job.images ?? [])].sort((a, b) => (a.order ?? a.index) - (b.order ?? b.index));
    for (const im of images) {
      const label = im.label || `Ảnh ${im.index + 1}`;
      const fig = document.createElement('figure');
      const img = document.createElement('img');
      img.src = `${ctx.getBridgeUrl()}${im.url}`;
      img.alt = label;
      img.style.height = '180px';
      img.addEventListener('click', () => window.open(img.src, '_blank'));

      const title = document.createElement('div');
      title.textContent = label;
      title.style.cssText = 'font-size:12px; font-weight:600; margin-top:6px;';

      const cap = document.createElement('figcaption');
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
      toRef.textContent = 'Dùng làm ref';
      toRef.title = 'Đưa ảnh này vào bộ ảnh tham chiếu của tab Phối ảnh';
      toRef.addEventListener('click', guard(async () => {
        const blob = await fetchBlob();
        await ctx.addAsReference(new File([blob], `room_${job.id.slice(0, 8)}_${im.index + 1}.png`, { type: blob.type || 'image/png' }));
        ctx.switchTab('tab-studio');
      }));

      const toStrict = document.createElement('button');
      toStrict.textContent = 'Sửa vùng';
      toStrict.addEventListener('click', guard(async () => {
        const blob = await fetchBlob();
        await ctx.sendToStrictTab(new Uint8Array(await blob.arrayBuffer()), label);
        ctx.switchTab('tab-strict');
      }));

      cap.append(dl, toRef, toStrict);
      fig.append(img, title, cap);
      gallery.append(fig);
    }
  }
}
