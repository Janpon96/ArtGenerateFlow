import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

const alias = {
  '@frs/domain': p('./packages/domain/src/index.ts'),
  '@frs/prompt-core': p('./packages/prompt-core/src/index.ts'),
  '@frs/image-core': p('./packages/image-core/src/index.ts'),
  '@frs/storage': p('./packages/storage/src/index.ts'),
  '@frs/job-orchestrator': p('./packages/job-orchestrator/src/index.ts'),
  '@frs/review-export': p('./packages/review-export/src/index.ts'),
  '@frs/provider-mock': p('./packages/providers/mock/src/index.ts'),
  '@frs/provider-flow-web': p('./packages/providers/flow-web/src/index.ts'),
};

const project = (name: string, dir: string) => ({
  resolve: { alias },
  test: { name, include: [`tests/${dir}/**/*.test.ts`] },
});

export default defineConfig({
  test: {
    projects: [
      project('unit', 'unit'),
      project('integration', 'integration'),
      project('e2e-mock', 'e2e-mock'),
    ],
  },
});
