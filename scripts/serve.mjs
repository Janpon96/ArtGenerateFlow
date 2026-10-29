// Serves apps/extension/dist on 127.0.0.1 only, so the Workbench can run as a normal web page.
// No dependencies. The page is local-first: nothing is sent anywhere by this server.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'extension', 'dist');
const PORT = Number(process.env.FRS_PORT ?? 5173);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
};

const server = http.createServer(async (req, res) => {
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
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Cong ${PORT} dang duoc dung (co the server da chay san). Dung trang da mo.`);
    process.exit(0);
  }
  throw e;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Workbench: http://127.0.0.1:${PORT}/workbench.html`);
  console.log('Dong cua so nay de tat server.');
});
