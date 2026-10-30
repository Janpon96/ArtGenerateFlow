/**
 * video-tab.ts: Tab Video (Omni Flash): chọn mode, frame đầu/cuối, phụ đề, giọng đọc, nhạc; xem trước và tải.
 */
import {
  DEFAULT_CREDITS,
  estimateCredits,
  needsCreditConfirm,
  parseCues,
  type VideoCue,
} from './video-helpers';

export interface VideoTabContext {
  bridgeFetch: (path: string, init?: RequestInit) => Promise<Response>;
  log: (level: 'info' | 'warn' | 'error', msg: string, jobId?: string) => void;
  getBridgeUrl: () => string;
  /** Ảnh kết quả gần nhất của tab Image (Sửa vùng), hoặc null. */
  getImageResultBytes: () => Uint8Array | null;
}

interface FileB64 {
  name: string;
  mime: string;
  base64: string;
}

interface Picked extends FileB64 {
  dataUrl: string;
}

interface VideoCaps {
  models: Array<{
    id: string;
    modes: string[];
    durations: number[];
    resolutions: string[];
    aspects: string[];
    max_refs: number;
    credits: Record<string, number>;
  }>;
  tts_engines: Array<{ id: string; available: boolean }>;
  voices: Array<{ id: string; label: string; engine: string }>;
  ffmpeg: { subtitles: boolean };
}

interface VideoJob {
  id: string;
  state: string;
  error?: string | null;
  steps?: Array<{ level?: string; msg: string }>;
  outputs?: { raw?: boolean; final?: boolean; srt?: boolean; audio?: boolean };
  warnings?: string[];
  raw_info?: { duration: number; has_audio: boolean; width: number; height: number };
}

const FINAL = new Set(['done', 'error', 'cancelled']);
const STATE_LABEL: Record<string, string> = {
  queued: 'Đang xếp hàng',
  uploading: 'Tải ảnh lên Flow',
  generating: 'Đang gửi yêu cầu',
  downloading: 'Đang chờ Flow tạo video (1-3 phút)',
  postprocess: 'Ghép phụ đề / âm thanh',
  done: 'Hoàn tất',
  error: 'Lỗi',
  cancelled: 'Đã hủy',
};
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_BYTES = 30 * 1024 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fileToB64(file: File): Promise<FileB64> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { name: file.name, mime: file.type || 'application/octet-stream', base64: bytesToBase64(bytes) };
}

export function initVideoTab(ctx: VideoTabContext): void {
  const $ = <T extends HTMLElement>(id: string) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Không tìm thấy phần tử #${id}`);
    return el as T;
  };

  let caps: VideoCaps | null = null;
  let creditTable: Record<string, number> = DEFAULT_CREDITS;
  let startFrame: Picked | null = null;
  let endFrame: Picked | null = null;
  const refs: Picked[] = [];
  let music: FileB64 | null = null;
  let currentId: string | null = null;
  let busy = false;

  const setStatus = (text: string, level: 'info' | 'warn' | 'error' = 'info') => {
    const box = $('vid-status');
    box.textContent = text;
    box.style.color = level === 'error' ? '#f87171' : level === 'warn' ? '#fbbf24' : '';
  };

  function val(id: string): string {
    return $<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id).value;
  }

  function currentMode(): string {
    return val('vid-mode');
  }

  function duration(): number {
    return Number(val('vid-duration'));
  }

  function refreshCost(): void {
    const c = estimateCredits(duration(), creditTable);
    $('vid-cost').textContent = c > 0 ? `Ước tính: ${c} credit` : 'Ước tính: không rõ';
  }

  function refreshModeVisibility(): void {
    const m = currentMode();
    $('vid-start-box').style.display = m === 'first_frame' || m === 'first_last' ? '' : 'none';
    $('vid-end-box').style.display = m === 'first_last' ? '' : 'none';
    $('vid-refs-box').style.display = m === 'reference' ? '' : 'none';
  }

  function renderPicked(boxId: string, item: Picked | null, onClear: () => void): void {
    const box = $(boxId);
    box.replaceChildren();
    if (!item) {
      const sp = document.createElement('span');
      sp.className = 'card-sub';
      sp.style.fontSize = '12px';
      sp.textContent = 'Chưa chọn ảnh.';
      box.append(sp);
      return;
    }
    const img = document.createElement('img');
    img.src = item.dataUrl;
    img.style.cssText = 'width:56px;height:56px;object-fit:contain;border-radius:4px;border:1px solid #475569;';
    const name = document.createElement('span');
    name.style.fontSize = '12px';
    name.textContent = item.name;
    const clear = document.createElement('button');
    clear.className = 'sm danger';
    clear.textContent = 'Bỏ';
    clear.addEventListener('click', onClear);
    box.append(img, name, clear);
  }

  function renderStart(): void {
    renderPicked('vid-start-preview', startFrame, () => {
      startFrame = null;
      renderStart();
    });
  }
  function renderEnd(): void {
    renderPicked('vid-end-preview', endFrame, () => {
      endFrame = null;
      renderEnd();
    });
  }
  function renderRefs(): void {
    const box = $('vid-refs-list');
    box.replaceChildren();
    if (refs.length === 0) {
      const sp = document.createElement('span');
      sp.className = 'card-sub';
      sp.style.fontSize = '12px';
      sp.textContent = 'Chưa chọn ảnh reference.';
      box.append(sp);
      return;
    }
    refs.forEach((r, i) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;';
      const img = document.createElement('img');
      img.src = r.dataUrl;
      img.style.cssText = 'width:56px;height:56px;object-fit:contain;border-radius:4px;border:1px solid #475569;';
      const b = document.createElement('button');
      b.className = 'sm danger';
      b.textContent = 'Bỏ';
      b.addEventListener('click', () => {
        refs.splice(i, 1);
        renderRefs();
      });
      wrap.append(img, b);
      box.append(wrap);
    });
  }

  async function pick(file: File): Promise<Picked | null> {
    if (!file.type.startsWith('image/')) {
      setStatus(`"${file.name}" không phải ảnh.`, 'warn');
      return null;
    }
    if (file.size > MAX_FILE_BYTES) {
      setStatus(`"${file.name}" lớn hơn 8 MB.`, 'warn');
      return null;
    }
    const f = await fileToB64(file);
    return { ...f, mime: file.type, dataUrl: `data:${file.type};base64,${f.base64}` };
  }

  function pickFromResult(): Picked | null {
    const bytes = ctx.getImageResultBytes();
    if (!bytes) {
      setStatus('Tab Image (Sửa vùng) chưa có ảnh kết quả nào.', 'warn');
      return null;
    }
    const b64 = bytesToBase64(bytes);
    return { name: `image_result_${Date.now()}.png`, mime: 'image/png', base64: b64, dataUrl: `data:image/png;base64,${b64}` };
  }

  // ---- Capabilities ----
  function fillSelect(id: string, values: Array<{ value: string; label: string }>): void {
    const sel = $<HTMLSelectElement>(id);
    const keep = sel.value;
    sel.replaceChildren(
      ...values.map((v) => {
        const o = document.createElement('option');
        o.value = v.value;
        o.textContent = v.label;
        return o;
      }),
    );
    if (values.some((v) => v.value === keep)) sel.value = keep;
  }

  async function loadCaps(): Promise<void> {
    try {
      const res = await ctx.bridgeFetch('/videos/capabilities');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      caps = (await res.json()) as VideoCaps;
    } catch (e) {
      setStatus(`Không đọc được khả năng của bridge: ${(e as Error).message}. Hãy chạy lại bridge.`, 'error');
      return;
    }
    const m = caps.models[0];
    if (m) {
      creditTable = m.credits;
      const modeLabel: Record<string, string> = {
        text: 'Text → Video',
        first_frame: 'Ảnh → Video (frame đầu)',
        first_last: 'Frame đầu + cuối',
        reference: 'Ảnh tham chiếu (reference)',
      };
      fillSelect('vid-mode', m.modes.map((x) => ({ value: x, label: modeLabel[x] ?? x })));
      fillSelect('vid-duration', m.durations.map((d) => ({ value: String(d), label: `${d} giây` })));
      fillSelect('vid-res', m.resolutions.map((r) => ({ value: r, label: r })));
      fillSelect('vid-aspect', m.aspects.map((a) => ({ value: a, label: a })));
      $<HTMLInputElement>('vid-refs-input').title = `Tối đa ${m.max_refs} ảnh`;
    }
    fillSelect(
      'vid-voice-engine',
      caps.tts_engines.map((e) => ({ value: e.id, label: e.available ? e.id : `${e.id} (chưa cài)` })),
    );
    const firstOk = caps.tts_engines.find((e) => e.available);
    if (firstOk) $<HTMLSelectElement>('vid-voice-engine').value = firstOk.id;
    refreshVoices();
    if (!caps.ffmpeg.subtitles) {
      $<HTMLSelectElement>('vid-sub-mode').value = 'srt';
      setStatus('ffmpeg trên máy này không có filter subtitles: chỉ xuất được tệp .srt.', 'warn');
    }
    refreshModeVisibility();
    refreshCost();
  }

  function refreshVoices(): void {
    if (!caps) return;
    const engine = val('vid-voice-engine');
    const list = caps.voices.filter((v) => v.engine === engine);
    fillSelect('vid-voice-voice', list.length ? list.map((v) => ({ value: v.id, label: v.label })) : [{ value: '', label: 'Giọng mặc định của hệ thống' }]);
  }

  // ---- Build request ----
  function buildBody(): Record<string, unknown> {
    const mode = currentMode();
    const prompt = val('vid-prompt').trim();
    if (!prompt) throw new Error('Hãy nhập prompt.');
    const dur = duration();
    const body: Record<string, unknown> = {
      model: 'omni-flash',
      mode,
      prompt,
      duration: dur,
      resolution: val('vid-res'),
      aspect_ratio: val('vid-aspect'),
    };
    const seed = val('vid-seed').trim();
    if (seed) {
      if (!/^\d+$/.test(seed)) throw new Error('Seed phải là số nguyên không âm.');
      body.seed = Number(seed);
    }
    const strip = (p: Picked): FileB64 => ({ name: p.name, mime: p.mime, base64: p.base64 });
    if (mode === 'first_frame' || mode === 'first_last') {
      if (!startFrame) throw new Error('Hãy chọn ảnh frame đầu.');
      body.start_frame = strip(startFrame);
    }
    if (mode === 'first_last') {
      if (!endFrame) throw new Error('Hãy chọn ảnh frame cuối.');
      body.end_frame = strip(endFrame);
    }
    if (mode === 'reference') {
      if (refs.length === 0) throw new Error('Hãy chọn ít nhất 1 ảnh reference.');
      body.references = refs.map(strip);
    }
    if ($<HTMLInputElement>('vid-sub-enable').checked) {
      const cues: VideoCue[] = parseCues(val('vid-sub-text'), dur);
      if (cues.length === 0) throw new Error('Bật phụ đề nhưng chưa nhập nội dung.');
      body.subtitles = {
        cues,
        mode: val('vid-sub-mode'),
        position: val('vid-sub-position'),
        size: Number(val('vid-sub-size')) || 36,
      };
    }
    if ($<HTMLInputElement>('vid-voice-enable').checked) {
      const text = val('vid-voice-text').trim();
      if (!text) throw new Error('Bật giọng đọc nhưng chưa nhập văn bản.');
      const voice: Record<string, unknown> = {
        text,
        engine: val('vid-voice-engine'),
        speed: Number(val('vid-voice-speed')) || 1,
        volume: Number(val('vid-voice-volume')) || 1,
      };
      const v = val('vid-voice-voice');
      if (v) voice.voice = v;
      body.voice = voice;
    }
    if ($<HTMLInputElement>('vid-music-enable').checked) {
      if (!music) throw new Error('Bật nhạc nền nhưng chưa chọn tệp.');
      body.music = {
        file: music,
        volume: Number(val('vid-music-volume')) || 0.25,
        duck_under_voice: $<HTMLInputElement>('vid-music-duck').checked,
      };
    }
    return body;
  }

  async function errorText(res: Response): Promise<string> {
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === 'string') return j.detail;
      if (j.detail) return JSON.stringify(j.detail);
    } catch {
      /* không phải JSON */
    }
    return `HTTP ${res.status}`;
  }

  function setBusy(b: boolean): void {
    busy = b;
    $<HTMLButtonElement>('vid-generate').disabled = b;
    $<HTMLButtonElement>('vid-cancel').disabled = !b;
  }

  function fileUrl(id: string, kind: string, extra = ''): string {
    return `${ctx.getBridgeUrl()}/videos/${id}/file?kind=${kind}${extra}`;
  }

  function showResult(job: VideoJob): void {
    const player = $<HTMLVideoElement>('vid-player');
    player.src = fileUrl(job.id, 'final', `&v=${Date.now()}`);
    player.style.display = '';
    $<HTMLButtonElement>('vid-download').disabled = false;
    $<HTMLButtonElement>('vid-download-srt').disabled = !job.outputs?.srt;
    $<HTMLButtonElement>('vid-download-raw').disabled = !job.outputs?.raw;
  }

  async function pollVideo(id: string): Promise<VideoJob> {
    const deadline = Date.now() + 15 * 60 * 1000;
    let lastMsg = '';
    for (;;) {
      const res = await ctx.bridgeFetch(`/videos/${id}`);
      if (!res.ok) throw new Error(`Không đọc được trạng thái video: ${await errorText(res)}`);
      const job = (await res.json()) as VideoJob;
      const msg = job.steps?.length ? job.steps[job.steps.length - 1]!.msg : '';
      if (msg && msg !== lastMsg) {
        lastMsg = msg;
        ctx.log('info', msg, id);
      }
      setStatus(`${STATE_LABEL[job.state] ?? job.state}${msg ? ` · ${msg}` : ''}`);
      if (FINAL.has(job.state)) return job;
      if (Date.now() > deadline) throw new Error('Quá thời gian chờ (15 phút). Job vẫn có thể đang chạy trên bridge.');
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  async function generate(): Promise<void> {
    if (busy) return;
    let body: Record<string, unknown>;
    try {
      body = buildBody();
    } catch (e) {
      setStatus((e as Error).message, 'warn');
      return;
    }
    const credits = estimateCredits(duration(), creditTable);
    if (needsCreditConfirm(credits) && !confirm(`Video này tốn khoảng ${credits} credit. Tiếp tục?`)) return;

    setBusy(true);
    $<HTMLButtonElement>('vid-download').disabled = true;
    $<HTMLButtonElement>('vid-download-srt').disabled = true;
    $<HTMLButtonElement>('vid-download-raw').disabled = true;
    $('vid-player').style.display = 'none';
    setStatus('Đang gửi yêu cầu tới bridge...');
    try {
      const res = await ctx.bridgeFetch('/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await errorText(res));
      const created = (await res.json()) as VideoJob;
      currentId = created.id;
      ctx.log('info', `Đã tạo job video #${created.id.slice(0, 8)}`, created.id);
      const job = await pollVideo(created.id);
      if (job.state === 'done') {
        showResult(job);
        const extra: string[] = [];
        if (job.raw_info) extra.push(`${job.raw_info.width}x${job.raw_info.height}, ${job.raw_info.duration.toFixed(1)}s`);
        if (job.warnings?.length) extra.push(`Cảnh báo: ${job.warnings.join('; ')}`);
        setStatus(`Hoàn tất. ${extra.join(' · ')}`, job.warnings?.length ? 'warn' : 'info');
      } else if (job.state === 'cancelled') {
        setStatus('Đã hủy.', 'warn');
      } else {
        setStatus(`Lỗi: ${job.error ?? 'không rõ'}`, 'error');
        ctx.log('error', `Video lỗi: ${job.error ?? 'không rõ'}`, job.id);
      }
    } catch (e) {
      setStatus((e as Error).message, 'error');
      ctx.log('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(): Promise<void> {
    if (!currentId) return;
    try {
      const res = await ctx.bridgeFetch(`/videos/${currentId}/cancel`, { method: 'POST' });
      if (!res.ok) setStatus(await errorText(res), 'warn');
    } catch (e) {
      setStatus((e as Error).message, 'error');
    }
  }

  function download(kind: string): void {
    if (!currentId) return;
    const a = document.createElement('a');
    a.href = fileUrl(currentId, kind, '&download=1');
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
  }

  async function previewVoice(): Promise<void> {
    const text = val('vid-voice-text').trim().slice(0, 300);
    if (!text) {
      setStatus('Hãy nhập văn bản giọng đọc để nghe thử.', 'warn');
      return;
    }
    setStatus('Đang tạo giọng nghe thử...');
    try {
      const payload: Record<string, unknown> = {
        text,
        engine: val('vid-voice-engine'),
        speed: Number(val('vid-voice-speed')) || 1,
      };
      const v = val('vid-voice-voice');
      if (v) payload.voice = v;
      const res = await ctx.bridgeFetch('/videos/tts-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await errorText(res));
      const blob = await res.blob();
      const audio = $<HTMLAudioElement>('vid-voice-audio');
      if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
      audio.src = URL.createObjectURL(blob);
      audio.style.display = '';
      await audio.play().catch(() => undefined);
      setStatus('Sẵn sàng.');
    } catch (e) {
      setStatus(`Nghe thử thất bại: ${(e as Error).message}`, 'error');
    }
  }

  // ---- Wiring ----
  $('vid-mode').addEventListener('change', refreshModeVisibility);
  $('vid-duration').addEventListener('change', refreshCost);
  $('vid-voice-engine').addEventListener('change', refreshVoices);

  $('vid-start').addEventListener('change', async () => {
    const input = $<HTMLInputElement>('vid-start');
    const f = input.files?.[0];
    if (f) startFrame = (await pick(f)) ?? startFrame;
    input.value = '';
    renderStart();
  });
  $('vid-end').addEventListener('change', async () => {
    const input = $<HTMLInputElement>('vid-end');
    const f = input.files?.[0];
    if (f) endFrame = (await pick(f)) ?? endFrame;
    input.value = '';
    renderEnd();
  });
  $('vid-start-use').addEventListener('click', () => {
    startFrame = pickFromResult() ?? startFrame;
    renderStart();
  });
  $('vid-end-use').addEventListener('click', () => {
    endFrame = pickFromResult() ?? endFrame;
    renderEnd();
  });
  $('vid-refs-input').addEventListener('change', async () => {
    const input = $<HTMLInputElement>('vid-refs-input');
    const max = caps?.models[0]?.max_refs ?? 7;
    for (const f of Array.from(input.files ?? [])) {
      if (refs.length >= max) {
        setStatus(`Tối đa ${max} ảnh reference.`, 'warn');
        break;
      }
      const p = await pick(f);
      if (p) refs.push(p);
    }
    input.value = '';
    renderRefs();
  });
  $('vid-music-file').addEventListener('change', async () => {
    const input = $<HTMLInputElement>('vid-music-file');
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    if (f.size > MAX_AUDIO_BYTES) {
      setStatus('Tệp nhạc lớn hơn 30 MB.', 'warn');
      return;
    }
    music = await fileToB64(f);
    $('vid-music-name').textContent = f.name;
  });
  $('vid-voice-preview').addEventListener('click', () => void previewVoice());
  $('vid-generate').addEventListener('click', () => void generate());
  $('vid-cancel').addEventListener('click', () => void cancel());
  $('vid-download').addEventListener('click', () => download('final'));
  $('vid-download-srt').addEventListener('click', () => download('srt'));
  $('vid-download-raw').addEventListener('click', () => download('raw'));

  renderStart();
  renderEnd();
  renderRefs();
  refreshModeVisibility();
  refreshCost();
  setBusy(false);
  void loadCaps();
}
