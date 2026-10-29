// Packages apps/extension/dist into release/: a zip, build-info.json and a SHA-256 checksum.
// It does not publish anything. Run `pnpm build:extension` first.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync, crc32 } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'apps/extension/dist');
const out = join(root, 'release');

if (!existsSync(join(dist, 'manifest.json'))) {
  console.error('dist/manifest.json not found. Run `pnpm build:extension` first.');
  process.exit(1);
}

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(dist).filter((p) => !p.endsWith('build-info.json')).sort();
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');

const info = {
  name: manifest.name,
  version: manifest.version,
  builtAt: new Date().toISOString(),
  files: Object.fromEntries(files.map((p) => [relative(dist, p).replaceAll('\\', '/'), sha(readFileSync(p))])),
};
writeFileSync(join(dist, 'build-info.json'), JSON.stringify(info, null, 2));

// Minimal zip writer (deflate, no zip64): enough for a small extension.
const entries = [...files, join(dist, 'build-info.json')].sort();
const locals = [];
const central = [];
let offset = 0;
for (const p of entries) {
  const name = Buffer.from(relative(dist, p).replaceAll('\\', '/'));
  const data = readFileSync(p);
  const comp = deflateRawSync(data);
  const crc = crc32(data);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
  lh.writeUInt16LE(8, 8); lh.writeUInt32LE(0x21, 12); // fixed DOS date 1980-01-01
  lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(name.length, 26);
  locals.push(lh, name, comp);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
  ch.writeUInt16LE(8, 10); ch.writeUInt32LE(0x21, 14);
  ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
  ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
  central.push(ch, name);
  offset += lh.length + name.length + comp.length;
}
const cd = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...locals, cd, end]);

mkdirSync(out, { recursive: true });
const zipName = `flow-reference-studio-${manifest.version}.zip`;
writeFileSync(join(out, zipName), zip);
writeFileSync(join(out, `${zipName}.sha256`), `${sha(zip)}  ${zipName}\n`);
console.log(`Wrote release/${zipName} (${zip.length} bytes, ${entries.length} files), sha256 ${sha(zip)}`);
