import { FLOW_ASSISTED_ADAPTER_VERSION } from '@frs/provider-flow-web';

const BALANCE_KEY = 'frs.credits.balance';
const BRIDGE_HEALTH = 'http://127.0.0.1:8200/health';

function openWorkbench(hash = ''): void {
  const suffix = hash ? `#${hash}` : '';
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime?.getURL) {
    void chrome.tabs.create({ url: chrome.runtime.getURL(`workbench.html${suffix}`) });
  } else {
    window.open(`workbench.html${suffix}`, '_blank');
  }
}

document.getElementById('open')?.addEventListener('click', () => openWorkbench());

document.getElementById('open-flow')?.addEventListener('click', () => {
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    void chrome.tabs.create({ url: 'https://flow.google.com' });
  } else {
    window.open('https://flow.google.com', '_blank', 'noopener');
  }
});

document.querySelectorAll<HTMLButtonElement>('.tool-tile[data-target]').forEach((btn) => {
  btn.addEventListener('click', () => {
    openWorkbench(btn.dataset.target || '');
  });
});

// ---- Đồng bộ Ví Token với Workbench ----
const balInput = document.getElementById('sp-balance') as HTMLInputElement | null;
const walletHint = document.getElementById('sp-wallet-hint');

function readStoredBalance(): number | null {
  try {
    const raw = localStorage.getItem(BALANCE_KEY);
    if (raw === null || raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

function writeStoredBalance(v: number | null): void {
  try {
    if (v === null) localStorage.removeItem(BALANCE_KEY);
    else localStorage.setItem(BALANCE_KEY, String(Math.max(0, Math.round(v))));
  } catch {
    /* ignore */
  }
  syncBalanceUi();
  if (walletHint) {
    walletHint.textContent = 'Đã lưu ✓';
    window.setTimeout(() => {
      if (walletHint) walletHint.textContent = 'Đồng bộ tự động';
    }, 1500);
  }
}

function syncBalanceUi(): void {
  if (!balInput || document.activeElement === balInput) return;
  const v = readStoredBalance();
  balInput.value = v === null ? '' : String(v);
}

balInput?.addEventListener('change', () => {
  const raw = balInput.value.trim();
  writeStoredBalance(raw === '' ? null : Math.max(0, Number(raw) || 0));
});

document.querySelectorAll<HTMLButtonElement>('.chip-btn[data-add]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const delta = Number(btn.dataset.add) || 0;
    const cur = readStoredBalance() ?? 0;
    writeStoredBalance(cur + delta);
  });
});

document.getElementById('sp-bal-clear')?.addEventListener('click', () => {
  writeStoredBalance(null);
});

window.addEventListener('storage', (ev) => {
  if (ev.key === BALANCE_KEY) syncBalanceUi();
});
syncBalanceUi();

// ---- Kiểm tra trạng thái Bridge ----
async function checkBridge(): Promise<void> {
  const badge = document.getElementById('sp-bridge');
  if (!badge) return;
  try {
    const res = await fetch(BRIDGE_HEALTH, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error('offline');
    const data = (await res.json()) as { extension_connected?: boolean; cooldown_remaining_s?: number };
    const cd = Math.ceil(Number(data.cooldown_remaining_s ?? 0));
    if (!data.extension_connected) {
      badge.className = 'badge warn';
      badge.textContent = 'FlowKit: chờ tab Flow';
    } else if (cd > 0) {
      badge.className = 'badge warn';
      badge.textContent = `Nghỉ ${cd}s`;
    } else {
      badge.className = 'badge ok';
      badge.textContent = 'Flow: sẵn sàng';
    }
  } catch {
    badge.className = 'badge danger';
    badge.textContent = 'Bridge: tắt';
  }
}

document.getElementById('sp-refresh')?.addEventListener('click', () => void checkBridge());
void checkBridge();

const statusEl = document.getElementById('status');
if (statusEl) {
  statusEl.textContent = `Adapter ${FLOW_ASSISTED_ADAPTER_VERSION}`;
}
