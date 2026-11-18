/**
 * credits.ts: Hệ thống theo dõi & highlight Token/Credit toàn cục (Topbar Wallet + Thanh Pre-flight + Nút Generate).
 * Đồng bộ tức thì giữa mọi tab trong Workbench và Sidepanel qua localStorage.
 */

import { showToast } from './ui-helpers';

export const BALANCE_KEY = 'frs.credits.balance';
export const IMAGE_CREDIT = 1;
export const ANIM_VIDEO_CREDIT = 20;

let balance: number | null = null;
const listeners: Array<() => void> = [];
let initialized = false;

function loadBalance(): void {
  try {
    const raw = localStorage.getItem(BALANCE_KEY);
    balance = raw === null || raw.trim() === '' ? null : Number(raw);
    if (balance !== null && (!Number.isFinite(balance) || balance < 0)) balance = null;
  } catch {
    balance = null;
  }
}

function notifyAll(): void {
  for (const fn of listeners) fn();
}

export function getCreditBalance(): number | null {
  if (!initialized) ensureInit();
  return balance;
}

export function saveCreditBalance(v: number | null): void {
  balance = v === null ? null : Math.max(0, Math.round(v));
  try {
    if (balance === null) localStorage.removeItem(BALANCE_KEY);
    else localStorage.setItem(BALANCE_KEY, String(balance));
  } catch {
    /* localStorage không khả dụng */
  }
  notifyAll();
}

function ensureInit(): void {
  if (initialized) return;
  initialized = true;
  loadBalance();
  window.addEventListener('storage', (ev) => {
    if (ev.key === BALANCE_KEY) {
      loadBalance();
      notifyAll();
    }
  });
}

export interface CreditBarOptions {
  /** id nút generate; thanh được chèn ngay trước hàng chứa nút. */
  buttonId: string;
  /** Số token dự kiến cho lần bấm hiện tại. */
  estimate: () => number;
  /** Ghi chú ngắn giải thích công thức tính (VD: "4 ảnh × 1", "Video 8s"). */
  detail?: () => string;
  /** true nếu nút không tự disabled khi chạy (trừ ngay lúc bấm). */
  deductOnClick?: boolean;
}

/** Gắn ví Token trên thanh Topbar để người dùng luôn thấy và chỉnh nhanh ở mọi vị trí cuộn trang. */
export function mountGlobalCreditWallet(containerId = 'topbar-wallet'): void {
  ensureInit();
  const host = document.getElementById(containerId);
  if (!host) return;

  host.className = 'wallet-pill';
  host.replaceChildren();

  const icon = document.createElement('span');
  icon.className = 'wallet-icon';
  icon.textContent = '💎';

  const label = document.createElement('span');
  label.className = 'wallet-label';
  label.textContent = 'Token:';

  const input = document.createElement('input');
  input.id = 'global-credit-input';
  input.type = 'number';
  input.min = '0';
  input.step = '1';
  input.placeholder = 'Nhập số dư';
  input.title = 'Số token/credit hiện có trên Google Flow (dùng chung toàn bộ công cụ)';

  const quickAdd = document.createElement('button');
  quickAdd.type = 'button';
  quickAdd.className = 'wallet-step-btn';
  quickAdd.textContent = '+20';
  quickAdd.title = 'Cộng nhanh 20 token vào số dư';
  quickAdd.addEventListener('click', () => {
    const next = (balance ?? 0) + 20;
    saveCreditBalance(next);
    showToast(`Đã cập nhật số dư: ${next} token`, 'ok', 2200);
  });

  host.append(icon, label, input, quickAdd);

  input.addEventListener('change', () => {
    const raw = input.value.trim();
    saveCreditBalance(raw === '' ? null : Math.max(0, Number(raw) || 0));
  });

  const renderWallet = (): void => {
    if (document.activeElement !== input) {
      input.value = balance === null ? '' : String(balance);
    }
    host.classList.toggle('is-empty', balance !== null && balance <= 0);
    host.classList.toggle('is-low', balance !== null && balance > 0 && balance <= 10);
    host.classList.toggle('is-unset', balance === null);
  };

  listeners.push(renderWallet);
  renderWallet();
}

export function mountCreditBar(opt: CreditBarOptions): void {
  ensureInit();
  const btn = document.getElementById(opt.buttonId) as HTMLButtonElement | null;
  const row = btn?.closest('.action-bar') ?? btn?.parentElement;
  if (!btn || !row) return;

  btn.classList.add('gen-cta');

  // Huy hiệu chi phí gắn trực tiếp trên nút Generate để mắt người dùng thấy ngay dưới trỏ chuột
  const btnPill = document.createElement('span');
  btnPill.className = 'btn-cost-pill';
  btn.append(btnPill);

  const bar = document.createElement('div');
  bar.className = 'credit-strip';

  // 1. Chi phí lần này
  const estItem = document.createElement('div');
  estItem.className = 'credit-item credit-cost-badge';
  const estLabel = document.createElement('span');
  estLabel.className = 'credit-label';
  estLabel.textContent = '⚡ Tốn lượt này';
  const estVal = document.createElement('span');
  estVal.className = 'credit-val';
  const estSub = document.createElement('span');
  estSub.className = 'credit-sub';
  estItem.append(estLabel, estVal, estSub);

  // 2. Số token hiện có (nhập trực tiếp)
  const balItem = document.createElement('div');
  balItem.className = 'credit-item credit-balance-badge';
  const balLabel = document.createElement('span');
  balLabel.className = 'credit-label';
  balLabel.textContent = '💎 Hiện có';
  const inputWrap = document.createElement('div');
  inputWrap.className = 'credit-input-wrap';
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.step = '1';
  input.placeholder = 'Nhập số';
  input.title = 'Nhập tổng số token/credit bạn đang có trên Flow (tự động lưu & đồng bộ mọi tab).';
  const unit = document.createElement('span');
  unit.className = 'credit-unit';
  unit.textContent = 'token';
  inputWrap.append(input, unit);
  balItem.append(balLabel, inputWrap);

  // 3. Dự kiến còn lại
  const afterItem = document.createElement('div');
  afterItem.className = 'credit-item credit-after-badge';
  const afterLabel = document.createElement('span');
  afterLabel.className = 'credit-label';
  afterLabel.textContent = '📊 Sau khi tạo';
  const afterVal = document.createElement('span');
  afterVal.className = 'credit-val';
  afterItem.append(afterLabel, afterVal);

  bar.append(estItem, balItem, afterItem);
  row.parentElement?.insertBefore(bar, row);

  let lastCost: number | null = null;

  const render = (): void => {
    const cost = Math.max(0, opt.estimate());
    const detail = opt.detail?.() ?? '';

    estVal.textContent = `${cost} token`;
    estSub.textContent = detail ? `(${detail})` : '';
    estSub.hidden = !detail;

    if (lastCost !== null && lastCost !== cost) {
      estItem.classList.remove('cost-bump');
      void estItem.offsetWidth;
      estItem.classList.add('cost-bump');
    }
    lastCost = cost;

    if (document.activeElement !== input) {
      input.value = balance === null ? '' : String(balance);
    }

    const insufficient = balance !== null && balance < cost && cost > 0;
    btnPill.textContent = insufficient ? `⚠ ${cost} token` : `⚡ ${cost} token`;
    btnPill.classList.toggle('is-insufficient', insufficient);

    afterItem.classList.remove('insufficient', 'sufficient', 'low-balance');
    if (balance === null) {
      afterVal.textContent = 'Nhập số dư để tính';
    } else {
      const left = balance - cost;
      if (left < 0) {
        afterVal.textContent = `Thiếu ${Math.abs(left)} token!`;
        afterItem.classList.add('insufficient');
      } else if (left <= 5) {
        afterVal.textContent = `Còn ${left} token (Sắp cạn)`;
        afterItem.classList.add('low-balance');
      } else {
        afterVal.textContent = `Còn ${left} token`;
        afterItem.classList.add('sufficient');
      }
    }
  };
  listeners.push(render);

  input.addEventListener('change', () => {
    saveCreditBalance(input.value.trim() === '' ? null : Math.max(0, Number(input.value) || 0));
  });

  // Cảnh báo an toàn trước khi bấm Generate nếu số dư không đủ
  btn.addEventListener(
    'click',
    (ev) => {
      const cost = Math.max(0, opt.estimate());
      if (balance !== null && cost > 0 && balance < cost) {
        const ok = window.confirm(
          `Cảnh báo Token: Lượt tạo này cần ${cost} token nhưng số dư hiện có chỉ còn ${balance} token (thiếu ${cost - balance} token).\n\nBạn vẫn muốn tiếp tục gửi lệnh?`,
        );
        if (!ok) {
          ev.stopImmediatePropagation();
          ev.preventDefault();
        }
      }
    },
    true,
  );

  const spend = (cost: number): void => {
    if (balance !== null && cost > 0) {
      saveCreditBalance(Math.max(0, balance - cost));
    }
  };

  if (opt.deductOnClick) {
    btn.addEventListener('click', () => spend(opt.estimate()));
  } else {
    let wasDisabled = btn.disabled;
    new MutationObserver(() => {
      if (btn.disabled && !wasDisabled) {
        spend(opt.estimate());
      }
      wasDisabled = btn.disabled;
    }).observe(btn, { attributes: true, attributeFilter: ['disabled'] });
  }

  let queued = false;
  const schedule = (): void => {
    if (queued) return;
    queued = true;
    window.setTimeout(() => {
      queued = false;
      render();
    }, 0);
  };
  document.addEventListener('input', schedule);
  document.addEventListener('change', schedule);
  document.addEventListener('click', schedule);

  const watch = new MutationObserver(schedule);
  for (const id of ['room-count', 'cam-count', 'vid-cost']) {
    const el = document.getElementById(id);
    if (el) watch.observe(el, { childList: true, characterData: true, subtree: true });
  }
  render();
}

const numberIn = (id: string): number => {
  const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  return Number(el?.value) || 0;
};
const textNumber = (id: string, re: RegExp): number => {
  const m = re.exec(document.getElementById(id)?.textContent ?? '');
  return m ? Number(m[1]) : 0;
};

/** Gắn ví Topbar và thanh Token cho mọi tab generate. Gọi sau khi các tab đã khởi tạo. */
export function mountAllCreditBars(): void {
  mountGlobalCreditWallet();

  mountCreditBar({
    buttonId: 'newjob',
    estimate: () => Math.max(1, numberIn('out-count')) * IMAGE_CREDIT,
    detail: () => `${Math.max(1, numberIn('out-count'))} ảnh × ${IMAGE_CREDIT}`,
  });

  mountCreditBar({
    buttonId: 'edit-generate',
    estimate: () => Math.max(1, numberIn('edit-count')) * IMAGE_CREDIT,
    detail: () => `${Math.max(1, numberIn('edit-count'))} lượt inpaint`,
  });

  mountCreditBar({
    buttonId: 'asset-generate',
    estimate: () => Math.max(1, numberIn('asset-count')) * IMAGE_CREDIT,
    detail: () => `${Math.max(1, numberIn('asset-count'))} biến thể`,
  });

  mountCreditBar({
    buttonId: 'room-generate',
    estimate: () => textNumber('room-count', /Sẽ tạo (\d+)/) * IMAGE_CREDIT,
    detail: () => `${textNumber('room-count', /Sẽ tạo (\d+)/)} góc phòng`,
  });

  mountCreditBar({
    buttonId: 'cam-generate',
    estimate: () => textNumber('cam-count', /Sẽ tạo (\d+)/) * IMAGE_CREDIT,
    detail: () => `${textNumber('cam-count', /Sẽ tạo (\d+)/)} góc máy`,
  });

  mountCreditBar({
    buttonId: 'anim-generate',
    estimate: () =>
      (document.getElementById('anim-mode') as HTMLSelectElement | null)?.value === 'video'
        ? ANIM_VIDEO_CREDIT
        : Math.max(1, numberIn('anim-frames')) * IMAGE_CREDIT,
    detail: () =>
      (document.getElementById('anim-mode') as HTMLSelectElement | null)?.value === 'video'
        ? 'Video Loop 8s'
        : `${Math.max(1, numberIn('anim-frames'))} frames lẻ`,
  });

  mountCreditBar({
    buttonId: 'vid-generate',
    estimate: () => textNumber('vid-cost', /(\d+)/),
    detail: () => `${numberIn('vid-duration') || 8}s • ${(document.getElementById('vid-res') as HTMLSelectElement | null)?.value || '720p'}`,
  });
}
