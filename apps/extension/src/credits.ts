/**
 * credits.ts: thanh theo dõi credit cho các tab generate (ảnh, asset, room, camera, animation, video).
 * Hiển thị: chi phí ước tính của lần bấm kế tiếp, số dư hiện có (nhập tay, lưu localStorage,
 * dùng chung mọi tab) và số dư còn lại sau khi tạo. Số dư tự trừ khi một lần generate bắt đầu.
 * Flow không có API đọc số dư, nên người dùng nhập số dư thực một lần rồi chỉnh khi cần.
 */

const BALANCE_KEY = 'frs.credits.balance';
export const IMAGE_CREDIT = 1;
export const ANIM_VIDEO_CREDIT = 20;

let balance: number | null = null;
const bars: Array<() => void> = [];

function loadBalance(): void {
  try {
    const raw = localStorage.getItem(BALANCE_KEY);
    balance = raw === null || raw === '' ? null : Number(raw);
    if (balance !== null && !Number.isFinite(balance)) balance = null;
  } catch { balance = null; }
}

function saveBalance(v: number | null): void {
  balance = v;
  try {
    if (v === null) localStorage.removeItem(BALANCE_KEY);
    else localStorage.setItem(BALANCE_KEY, String(v));
  } catch { /* localStorage không khả dụng */ }
  bars.forEach((r) => r());
}

export interface CreditBarOptions {
  /** id nút generate; thanh được chèn ngay trước hàng chứa nút. */
  buttonId: string;
  /** Số credit dự kiến cho lần bấm hiện tại. */
  estimate: () => number;
  /** true nếu nút không tự disabled khi chạy (trừ ngay lúc bấm). */
  deductOnClick?: boolean;
}

export function mountCreditBar(opt: CreditBarOptions): void {
  if (!bars.length) loadBalance();
  const btn = document.getElementById(opt.buttonId) as HTMLButtonElement | null;
  const row = btn?.parentElement;
  if (!btn || !row) return;

  const bar = document.createElement('div');
  bar.className = 'credit-strip';

  // Item 1: Tốn ước tính
  const estItem = document.createElement('div');
  estItem.className = 'credit-item credit-cost-badge';
  const estLabel = document.createElement('span');
  estLabel.className = 'credit-label';
  estLabel.textContent = '⚡ Chi phí lần này';
  const estVal = document.createElement('span');
  estVal.className = 'credit-val';
  estItem.append(estLabel, estVal);

  // Item 2: Số token hiện có (editable input)
  const balItem = document.createElement('div');
  balItem.className = 'credit-item credit-balance-badge';
  const balLabel = document.createElement('span');
  balLabel.className = 'credit-label';
  balLabel.textContent = '💎 Token hiện có';
  const inputWrap = document.createElement('div');
  inputWrap.className = 'credit-input-wrap';
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.step = '1';
  input.placeholder = 'Nhập số';
  input.title = 'Số token/credit hiện có trên Flow (nhấp vào để chỉnh sửa, tự đồng bộ mọi tab).';
  const unit = document.createElement('span');
  unit.className = 'credit-unit';
  unit.textContent = 'token';
  inputWrap.append(input, unit);
  balItem.append(balLabel, inputWrap);

  // Item 3: Còn lại sau khi tạo
  const afterItem = document.createElement('div');
  afterItem.className = 'credit-item credit-after-badge';
  const afterLabel = document.createElement('span');
  afterLabel.className = 'credit-label';
  afterLabel.textContent = '📊 Dự kiến còn';
  const afterVal = document.createElement('span');
  afterVal.className = 'credit-val';
  afterItem.append(afterLabel, afterVal);

  bar.append(estItem, balItem, afterItem);
  row.parentElement?.insertBefore(bar, row);

  const render = (): void => {
    const cost = opt.estimate();
    estVal.textContent = `${cost} token`;

    if (document.activeElement !== input) {
      input.value = balance === null ? '' : String(balance);
    }

    if (balance === null) {
      afterVal.textContent = '—';
      afterItem.classList.remove('insufficient', 'sufficient');
    } else {
      const left = balance - cost;
      if (left < 0) {
        afterVal.textContent = `${left} (THIẾU)`;
        afterItem.classList.add('insufficient');
        afterItem.classList.remove('sufficient');
      } else {
        afterVal.textContent = `${left} token`;
        afterItem.classList.remove('insufficient');
        afterItem.classList.add('sufficient');
      }
    }
  };
  bars.push(render);

  input.addEventListener('change', () => {
    saveBalance(input.value.trim() === '' ? null : Math.max(0, Number(input.value) || 0));
  });

  const spend = (cost: number): void => {
    if (balance !== null && cost > 0) saveBalance(Math.max(0, balance - cost));
  };
  if (opt.deductOnClick) {
    btn.addEventListener('click', () => spend(opt.estimate()));
  } else {
    // Nút tự disabled khi bắt đầu chạy (sau khi qua bước kiểm tra đầu vào): trừ đúng lúc đó.
    new MutationObserver(() => { if (btn.disabled) spend(opt.estimate()); })
      .observe(btn, { attributes: true, attributeFilter: ['disabled'] });
  }

  let queued = false;
  const schedule = (): void => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; render(); }, 0);
  };
  document.addEventListener('input', schedule);
  document.addEventListener('change', schedule);
  document.addEventListener('click', schedule);
  // Các ô văn bản do tab khác cập nhật (không quan sát chính thanh này để tránh vòng lặp).
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

/** Gắn thanh credit cho mọi tab generate. Gọi sau khi các tab đã khởi tạo. */
export function mountAllCreditBars(): void {
  mountCreditBar({ buttonId: 'newjob', deductOnClick: true,
    estimate: () => Math.max(1, numberIn('out-count')) * IMAGE_CREDIT });
  mountCreditBar({ buttonId: 'edit-generate',
    estimate: () => Math.max(1, numberIn('edit-count')) * IMAGE_CREDIT });
  mountCreditBar({ buttonId: 'asset-generate',
    estimate: () => Math.max(1, numberIn('asset-count')) * IMAGE_CREDIT });
  mountCreditBar({ buttonId: 'room-generate',
    estimate: () => textNumber('room-count', /Sẽ tạo (\d+)/) * IMAGE_CREDIT });
  mountCreditBar({ buttonId: 'cam-generate',
    estimate: () => textNumber('cam-count', /Sẽ tạo (\d+)/) * IMAGE_CREDIT });
  mountCreditBar({ buttonId: 'anim-generate',
    estimate: () => (document.getElementById('anim-mode') as HTMLSelectElement | null)?.value === 'video'
      ? ANIM_VIDEO_CREDIT
      : Math.max(1, numberIn('anim-frames')) * IMAGE_CREDIT });
  mountCreditBar({ buttonId: 'vid-generate',
    estimate: () => textNumber('vid-cost', /(\d+)/) });
}
