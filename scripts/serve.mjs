// Serves apps/extension/dist on 127.0.0.1 only, so the Workbench can run as a normal web page.
// No dependencies. The page is local-first: nothing is sent anywhere by this server.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'extension', 'dist');
export const WORKBENCH_PORT = Number(process.env.FRS_PORT ?? 5173);
export const WORKBENCH_URL = `http://127.0.0.1:${WORKBENCH_PORT}/workbench.html`;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
};

async function handle(req, res) {
  try {
    const rawPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    const rel = rawPath === '/' ? '/workbench.html' : rawPath;
    const file = path.resolve(root, '.' + rel);
    // Block path traversal outside dist.
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

/** True when something on the Workbench port already serves workbench.html. */
async function alreadyServing() {
  try {
    const res = await fetch(WORKBENCH_URL, { signal: AbortSignal.timeout(2000) });
    return res.ok && (await res.text()).includes('Flow Reference Studio');
  } catch {
    return false;
  }
}

/**
 * Starts the static server. Resolves `{ reused: true }` when a Workbench server is already
 * running on the port, and rejects when the port is held by something else.
 */
export function startWorkbenchServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handle);
    server.on('error', async (e) => {
      if (e.code === 'EADDRINUSE') {
        if (await alreadyServing()) resolve({ reused: true, server: null });
        else reject(new Error(`Cổng ${WORKBENCH_PORT} đang bị chương trình khác dùng. Đóng chương trình đó hoặc đặt biến FRS_PORT sang cổng khác.`));
        return;
      }
      reject(e);
    });
    server.listen(WORKBENCH_PORT, '127.0.0.1', () => resolve({ reused: false, server }));
  });
}

// Run directly: node scripts/serve.mjs
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { reused } = await startWorkbenchServer();
    console.log(reused ? `Workbench đã chạy sẵn: ${WORKBENCH_URL}` : `Workbench: ${WORKBENCH_URL}`);
    if (reused) process.exit(0);
    console.log('Đóng cửa sổ này để tắt server.');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
