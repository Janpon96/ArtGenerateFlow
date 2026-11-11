// One-command launcher used by run.bat:
//   build Workbench -> start (or reuse) the Python bridge server -> serve Workbench -> open browser,
// then keep watching the bridge and restart it if it dies.
//
// Options:  --no-build   skip the build step when dist already exists
//           --no-open    do not open any browser tab
// Env:      FRS_BRIDGE_DIR  folder that contains bridge_server.py (default: ..\FlowAutoTool)
//           FRS_PYTHON      python executable (default: python)
//           FRS_PORT        Workbench port (default: 5173)
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWorkbenchServer, WORKBENCH_URL } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT_DIR = path.join(ROOT, 'apps', 'extension');
const DIST_PAGE = path.join(EXT_DIR, 'dist', 'workbench.html');
const LOG_DIR = path.join(ROOT, 'logs');
const BRIDGE_DIR = path.resolve(process.env.FRS_BRIDGE_DIR || path.join(ROOT, '..', 'FlowAutoTool'));
const PYTHON = process.env.FRS_PYTHON || 'python';
// These ports are fixed by bridge_server.py and by the FlowKit extension.
const BRIDGE_PORT = 8200;
const WS_PORT = 9222;
const BRIDGE_URL = `http://127.0.0.1:${BRIDGE_PORT}`;
const FLOW_URL = 'https://flow.google.com';
const FLOWKIT_EXT_DIR = path.join(BRIDGE_DIR, 'upstream-flowkit', 'extension');
// import name -> pip package, for everything bridge_server.py needs at import time.
const PY_DEPS = {
  fastapi: 'fastapi', uvicorn: 'uvicorn', websockets: 'websockets', pydantic: 'pydantic',
  PIL: 'pillow', httpx: 'httpx', aiohttp: 'aiohttp', aiosqlite: 'aiosqlite', numpy: 'numpy',
  multipart: 'python-multipart',
};
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 10 * 60 * 1000;

const args = new Set(process.argv.slice(2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toLocaleTimeString('vi-VN', { hour12: false });
const info = (msg) => console.log(`[${stamp()}] ${msg}`);
const warn = (msg) => console.log(`[${stamp()}] [CẢNH BÁO] ${msg}`);

class LauncherError extends Error {}

function openUrl(url) {
  if (args.has('--no-open')) return;
  if (process.platform === 'win32') {
    spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

function portBusy(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.setTimeout(1000);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.once('error', () => resolve(false));
  });
}

/** PID listening on a local port (Windows only), or null. Used only to make error messages useful. */
function portOwner(port) {
  if (process.platform !== 'win32') return null;
  const out = spawnSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' }).stdout ?? '';
  for (const line of out.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length >= 5 && cols[3] === 'LISTENING' && cols[1].endsWith(`:${port}`)) return cols[4];
  }
  return null;
}

async function getJson(pathname) {
  const res = await fetch(`${BRIDGE_URL}${pathname}`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Health of *our* bridge, or null. Other servers that happen to use port 8200 do not count. */
async function bridgeHealth() {
  try {
    const h = await getJson('/health');
    return h && typeof h === 'object' && 'extension_connected' in h ? h : null;
  } catch {
    return null;
  }
}

async function isOurBridge() {
  if (!(await bridgeHealth())) return false;
  try {
    return Array.isArray((await getJson('/models')).models);
  } catch {
    return false;
  }
}

// ---------- step 1: build ----------
function buildWorkbench() {
  if (args.has('--no-build') && existsSync(DIST_PAGE)) {
    info('Bỏ qua build (--no-build).');
    return;
  }
  const r = spawnSync(process.execPath, ['build.mjs'], { cwd: EXT_DIR, stdio: 'inherit' });
  if (r.status === 0) return;
  if (!existsSync(DIST_PAGE)) {
    throw new LauncherError('Build Workbench thất bại và chưa có bản build cũ. Chạy "pnpm install" rồi thử lại.');
  }
  warn('Build Workbench thất bại, dùng tạm bản build cũ trong apps/extension/dist.');
}

// ---------- step 2: bridge ----------
function checkBridgeFiles() {
  if (!existsSync(path.join(BRIDGE_DIR, 'bridge_server.py'))) {
    throw new LauncherError(
      `Không thấy bridge_server.py trong "${BRIDGE_DIR}".\n` +
      '  Đặt biến môi trường FRS_BRIDGE_DIR trỏ tới thư mục FlowAutoTool rồi chạy lại, ví dụ:\n' +
      '    set "FRS_BRIDGE_DIR=D:\\duong\\dan\\FlowAutoTool"',
    );
  }
}

function ensurePython() {
  const v = spawnSync(PYTHON, ['--version'], { encoding: 'utf8' });
  if (v.error || v.status !== 0) {
    throw new LauncherError(`Không chạy được "${PYTHON}". Cài Python 3.10+ và thêm vào PATH, hoặc đặt biến FRS_PYTHON.`);
  }
  const probe =
    'import importlib.util as u, json, sys; ' +
    'print(json.dumps([m for m in sys.argv[1:] if u.find_spec(m) is None]))';
  const missing = () => {
    const r = spawnSync(PYTHON, ['-c', probe, ...Object.keys(PY_DEPS)], { encoding: 'utf8' });
    try { return JSON.parse(r.stdout.trim()); } catch { return Object.keys(PY_DEPS); }
  };
  let miss = missing();
  if (miss.length === 0) return;
  const pkgs = miss.map((m) => PY_DEPS[m]);
  info(`Thiếu thư viện Python: ${pkgs.join(', ')}. Đang cài bằng pip...`);
  spawnSync(PYTHON, ['-m', 'pip', 'install', ...pkgs], { stdio: 'inherit' });
  miss = missing();
  if (miss.length > 0) {
    throw new LauncherError(
      `Chưa cài được: ${miss.map((m) => PY_DEPS[m]).join(', ')}.\n` +
      `  Hãy tự chạy: ${PYTHON} -m pip install ${miss.map((m) => PY_DEPS[m]).join(' ')}`,
    );
  }
}

let bridgeChild = null;
let shuttingDown = false;
const bridgeTail = [];
const restartTimes = [];

function pipeLines(stream, onLine) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? '';
    for (const l of lines) onLine(l);
  });
  stream.on('end', () => { if (buf) onLine(buf); });
}

function spawnBridge() {
  mkdirSync(LOG_DIR, { recursive: true });
  const logFile = createWriteStream(path.join(LOG_DIR, 'bridge.log'), { flags: 'a' });
  logFile.write(`\n===== ${new Date().toISOString()} khởi động bridge =====\n`);
  const child = spawn(PYTHON, ['-u', 'bridge_server.py'], {
    cwd: BRIDGE_DIR,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const onLine = (line) => {
    if (!line.trim()) return;
    logFile.write(line + '\n');
    bridgeTail.push(line);
    if (bridgeTail.length > 40) bridgeTail.shift();
    console.log(`  [bridge] ${line}`);
  };
  pipeLines(child.stdout, onLine);
  pipeLines(child.stderr, onLine);
  child.on('error', (e) => onLine(`Không khởi động được python: ${e.message}`));
  child.on('exit', (code) => {
    logFile.end();
    if (bridgeChild === child) bridgeChild = null;
    if (!shuttingDown) warn(`Bridge server đã dừng (mã thoát ${code}).`);
  });
  bridgeChild = child;
  return child;
}

async function waitBridgeReady(child, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isOurBridge()) return true;
    if (child.exitCode !== null) return false;
    await sleep(500);
  }
  return false;
}

async function startBridge() {
  for (const port of [BRIDGE_PORT, WS_PORT]) {
    if (await portBusy(port)) {
      const pid = portOwner(port);
      throw new LauncherError(
        `Cổng ${port} đang bị chương trình khác dùng${pid ? ` (PID ${pid})` : ''}, bridge không thể khởi động.\n` +
        '  Thường là YTF Studio (ytf_server.py) hoặc FlowKit backend đang chạy. Hãy đóng nó' +
        (pid ? ` (taskkill /PID ${pid} /F)` : '') + ' rồi chạy lại run.bat.',
      );
    }
  }
  const child = spawnBridge();
  if (await waitBridgeReady(child)) return;
  killBridge();
  throw new LauncherError(
    'Bridge server không khởi động được. Các dòng log cuối:\n' +
    bridgeTail.slice(-15).map((l) => `    ${l}`).join('\n') +
    `\n  Log đầy đủ: ${path.join(LOG_DIR, 'bridge.log')}`,
  );
}

function killBridge() {
  const child = bridgeChild;
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

// ---------- step 4: watch ----------
function printFlowKitHelp() {
  console.log('');
  console.log('  FlowKit extension CHƯA kết nối với bridge. Để tạo ảnh qua Google Flow cần:');
  console.log('    1. Mở chrome://extensions, bật Developer mode, bấm "Load unpacked" và chọn thư mục:');
  console.log(`       ${FLOWKIT_EXT_DIR}`);
  console.log(`    2. Mở ${FLOW_URL} trong chính Chrome đó và đăng nhập tài khoản Google.`);
  console.log('    3. Giữ tab Flow mở. Launcher sẽ báo ngay khi extension kết nối được.');
  console.log('');
}

async function watch() {
  let connected = null;
  let cooling = false;
  let downCount = 0;
  let helped = false;
  const startedAt = Date.now();
  for (;;) {
    const h = await bridgeHealth();
    if (h) {
      downCount = 0;
      const now = Boolean(h.extension_connected);
      if (now !== connected) {
        if (now) info('FlowKit extension đã kết nối. Sẵn sàng tạo ảnh với Google Flow.');
        else if (connected !== null) warn('FlowKit extension vừa mất kết nối. Kiểm tra tab flow.google.com còn mở không.');
        connected = now;
      }
      if (!now && !helped && Date.now() - startedAt > 8000) {
        helped = true;
        printFlowKitHelp();
        openUrl(FLOW_URL); // waking a Flow tab is usually enough when the extension is already installed
      }
      const cd = Number(h.cooldown_remaining_s ?? 0);
      if (cd > 0 && !cooling) warn(`Google báo unusual activity, bridge đang nghỉ ${Math.ceil(cd)} giây.`);
      cooling = cd > 0;
    } else if (++downCount >= 3 && !bridgeChild) {
      downCount = 0;
      connected = null;
      const now = Date.now();
      while (restartTimes.length && now - restartTimes[0] > RESTART_WINDOW_MS) restartTimes.shift();
      if (restartTimes.length >= MAX_RESTARTS) {
        throw new LauncherError(`Bridge server dừng ${MAX_RESTARTS + 1} lần trong 10 phút. Xem ${path.join(LOG_DIR, 'bridge.log')} để biết nguyên nhân.`);
      }
      restartTimes.push(now);
      warn(`Bridge server không phản hồi, đang khởi động lại (lần ${restartTimes.length}/${MAX_RESTARTS})...`);
      await startBridge();
      info('Bridge server đã chạy lại.');
    }
    await sleep(h ? 5000 : 2000);
  }
}

// ---------- main ----------
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  killBridge();
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => shutdown(0));
process.on('exit', killBridge);

async function main() {
  console.log('==============================================');
  console.log('  Flow Reference Studio');
  console.log('==============================================');

  info('[1/4] Build Workbench...');
  buildWorkbench();

  info('[2/4] Bridge server (Python, cổng 8200)...');
  if (await isOurBridge()) {
    info('Bridge server đã chạy sẵn, dùng lại.');
  } else {
    checkBridgeFiles();
    ensurePython();
    info(`Khởi động bridge từ ${BRIDGE_DIR}`);
    await startBridge();
    info('Bridge server đã sẵn sàng.');
  }

  info('[3/4] Workbench server...');
  const { reused } = await startWorkbenchServer();
  info(reused ? `Workbench đã chạy sẵn: ${WORKBENCH_URL}` : `Workbench: ${WORKBENCH_URL}`);

  info('[4/4] Mở Workbench trên trình duyệt...');
  openUrl(WORKBENCH_URL);
  console.log('');
  console.log('  Giữ cửa sổ này mở trong lúc dùng. Nhấn Ctrl+C hoặc đóng cửa sổ để tắt bridge và Workbench.');
  console.log('');

  await watch();
}

main().catch((e) => {
  console.error('');
  console.error(e instanceof LauncherError ? `[LỖI] ${e.message}` : e);
  shuttingDown = true;
  killBridge();
  process.exit(1);
});
