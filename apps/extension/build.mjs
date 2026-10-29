import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = path.join(here, 'dist');
const p = (...s) => path.join(root, ...s);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: {
    background: path.join(here, 'src/background.ts'),
    sidepanel: path.join(here, 'src/sidepanel.ts'),
    workbench: path.join(here, 'src/workbench.ts'),
    'content-flow': path.join(here, 'src/content-flow.ts'),
  },
  outdir: out,
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  platform: 'browser',
  sourcemap: false,
  alias: {
    '@frs/domain': p('packages/domain/src/index.ts'),
    '@frs/prompt-core': p('packages/prompt-core/src/index.ts'),
    '@frs/image-core': p('packages/image-core/src/index.ts'),
    '@frs/storage': p('packages/storage/src/index.ts'),
    '@frs/job-orchestrator': p('packages/job-orchestrator/src/index.ts'),
    '@frs/review-export': p('packages/review-export/src/index.ts'),
    '@frs/provider-mock': p('packages/providers/mock/src/index.ts'),
    '@frs/provider-flow-web': p('packages/providers/flow-web/src/index.ts'),
  },
  logLevel: 'info',
});

for (const f of ['manifest.json', 'sidepanel.html', 'workbench.html']) {
  await cp(path.join(here, f), path.join(out, f));
}
await cp(path.join(here, 'icons'), path.join(out, 'icons'), { recursive: true });
console.log('extension built:', out);
