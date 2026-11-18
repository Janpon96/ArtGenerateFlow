/**
 * ui-helpers.ts: Toast thông báo nhẹ nhàng (thay cho alert chặn luồng) và Lightbox xem ảnh chi tiết.
 */

export type ToastKind = 'ok' | 'warn' | 'error' | 'info';

const TOAST_ICONS: Record<ToastKind, string> = {
  ok: '✓',
  warn: '!',
  error: '✕',
  info: 'i',
};

function ensureToastStack(): HTMLElement {
  let stack = document.getElementById('toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toast-stack';
    stack.setAttribute('aria-live', 'polite');
    document.body.append(stack);
  }
  return stack;
}

export function showToast(message: string, kind: ToastKind = 'info', durationMs = 3600): void {
  if (!message) return;
  const stack = ensureToastStack();
  while (stack.children.length >= 4) {
    stack.firstElementChild?.remove();
  }

  const item = document.createElement('div');
  item.className = `toast-item toast-${kind}`;

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.textContent = TOAST_ICONS[kind];

  const text = document.createElement('div');
  text.className = 'toast-text';
  text.textContent = message;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Đóng thông báo');
  close.textContent = '×';

  let closed = false;
  const dismiss = (): void => {
    if (closed) return;
    closed = true;
    item.classList.add('toast-leaving');
    window.setTimeout(() => item.remove(), 200);
  };

  close.addEventListener('click', dismiss);
  item.append(icon, text, close);
  stack.append(item);

  if (durationMs > 0) {
    window.setTimeout(dismiss, durationMs);
  }
}

export interface LightboxOptions {
  src: string;
  title?: string;
  subtitle?: string;
  downloadUrl?: string;
  downloadName?: string;
}

let lightboxMounted = false;
let checkerOn = true;
let zoomActual = false;

function ensureLightbox(): HTMLElement {
  let modal = document.getElementById('lightbox-modal');
  if (modal && lightboxMounted) return modal;

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'lightbox-modal';
    modal.className = 'lightbox-backdrop';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="lightbox-dialog" role="dialog" aria-modal="true" aria-label="Xem trước ảnh">
        <div class="lightbox-head">
          <div class="lightbox-titles">
            <strong id="lb-title">Xem trước ảnh</strong>
            <span id="lb-sub" class="card-sub"></span>
          </div>
          <div class="lightbox-tools">
            <button id="lb-checker" type="button" class="sm active" title="Bật/tắt nền ô cờ kiểm tra tách nền">Nền ô cờ</button>
            <button id="lb-zoom" type="button" class="sm" title="Chuyển giữa vừa khung và kích thước pixel gốc 1:1">1:1 Pixel</button>
            <a id="lb-open-tab" class="btn sm" target="_blank" rel="noopener">Mở tab mới</a>
            <a id="lb-download" class="btn sm primary">Tải xuống</a>
            <button id="lb-close" type="button" class="sm danger" title="Đóng (Esc)">Đóng ✕</button>
          </div>
        </div>
        <div id="lb-stage" class="lightbox-stage checkerboard">
          <img id="lb-img" alt="Preview" />
        </div>
      </div>
    `;
    document.body.append(modal);
  }

  const close = (): void => {
    modal!.hidden = true;
    document.body.classList.remove('modal-open');
  };

  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
  document.getElementById('lb-close')?.addEventListener('click', close);

  document.getElementById('lb-checker')?.addEventListener('click', (e) => {
    checkerOn = !checkerOn;
    const btn = e.currentTarget as HTMLButtonElement;
    btn.classList.toggle('active', checkerOn);
    document.getElementById('lb-stage')?.classList.toggle('checkerboard', checkerOn);
  });

  document.getElementById('lb-zoom')?.addEventListener('click', (e) => {
    zoomActual = !zoomActual;
    const btn = e.currentTarget as HTMLButtonElement;
    btn.classList.toggle('active', zoomActual);
    document.getElementById('lb-stage')?.classList.toggle('zoom-actual', zoomActual);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal!.hidden) close();
  });

  lightboxMounted = true;
  return modal;
}

export function openLightbox(opts: LightboxOptions): void {
  const modal = ensureLightbox();
  const img = document.getElementById('lb-img') as HTMLImageElement;
  const title = document.getElementById('lb-title') as HTMLElement;
  const sub = document.getElementById('lb-sub') as HTMLElement;
  const openTab = document.getElementById('lb-open-tab') as HTMLAnchorElement;
  const dl = document.getElementById('lb-download') as HTMLAnchorElement;
  const stage = document.getElementById('lb-stage') as HTMLElement;
  const zoomBtn = document.getElementById('lb-zoom') as HTMLButtonElement;

  zoomActual = false;
  stage.classList.remove('zoom-actual');
  zoomBtn.classList.remove('active');

  img.src = opts.src;
  img.onload = () => {
    const dim = `${img.naturalWidth} × ${img.naturalHeight} px`;
    sub.textContent = opts.subtitle ? `${dim} • ${opts.subtitle}` : dim;
  };
  title.textContent = opts.title || 'Xem trước hình ảnh';
  sub.textContent = opts.subtitle || '';
  openTab.href = opts.src;
  dl.href = opts.downloadUrl || opts.src;
  if (opts.downloadName) dl.download = opts.downloadName;
  else dl.setAttribute('download', '');

  modal.hidden = false;
  document.body.classList.add('modal-open');
}
