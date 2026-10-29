import { openFrsDb } from '@frs/storage';
import { JobOrchestrator } from '@frs/job-orchestrator';
import { FlowWebAssistedAdapter } from '@frs/provider-flow-web';

const BRIDGE_HEALTH_URL = 'http://127.0.0.1:8200/health';
const BRIDGE_ALARM = 'frs-bridge-health';

// Listeners are registered at top level so the service worker can be woken by them.
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void chrome.alarms.create(BRIDGE_ALARM, { periodInMinutes: 0.5 });
  void refreshBridgeBadge();
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.alarms.create(BRIDGE_ALARM, { periodInMinutes: 0.5 });
  void refreshBridgeBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BRIDGE_ALARM) void refreshBridgeBadge();
});

// Lets the workbench or side panel request an immediate refresh.
chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
  if (msg?.type === 'frs-bridge-refresh') void refreshBridgeBadge();
});

type BridgeState = 'connected' | 'no-flow' | 'offline';

function showBadge(state: BridgeState, extra = ''): void {
  const view: Record<BridgeState, { text: string; color: string; title: string }> = {
    connected: { text: 'ON', color: '#16a34a', title: 'Bridge đã kết nối, FlowKit sẵn sàng' },
    'no-flow': { text: '!', color: '#f59e0b', title: 'Bridge chạy nhưng FlowKit extension chưa kết nối' },
    offline: { text: 'OFF', color: '#dc2626', title: 'Không kết nối được bridge (127.0.0.1:8200). Hãy chạy run.bat' },
  };
  const v = view[state];
  void chrome.action.setBadgeText({ text: v.text });
  void chrome.action.setBadgeBackgroundColor({ color: v.color });
  void chrome.action.setTitle({ title: `Flow Reference Studio: ${v.title}${extra}` });
}

async function refreshBridgeBadge(): Promise<void> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(BRIDGE_HEALTH_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) { showBadge('offline'); return; }
    const data = (await res.json()) as { extension_connected?: boolean; cooldown_remaining_s?: number };
    const cd = Number(data.cooldown_remaining_s ?? 0);
    const extra = cd > 0 ? ` (đang nghỉ ${Math.ceil(cd)}s do unusual activity)` : '';
    showBadge(data.extension_connected ? 'connected' : 'no-flow', extra);
  } catch {
    showBadge('offline');
  }
}

// On every worker start, jobs that may have reached Flow go to NEEDS_RECONCILIATION.
// Nothing is ever re-submitted here.
async function recoverJobs(): Promise<void> {
  const db = await openFrsDb();
  const orch = new JobOrchestrator(db, new FlowWebAssistedAdapter(), { owner: `sw-${crypto.randomUUID()}` });
  if (await orch.acquire()) {
    try { await orch.recover(); } finally { await orch.release(); }
  }
}
void recoverJobs();
void refreshBridgeBadge();
