import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Guards the minimal-access promise: DOM automation is allowed on the Flow origin only.
const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../apps/extension/manifest.json'), 'utf8'));
const FLOW = 'https://flow.google.com/*';
const BRIDGE = 'http://127.0.0.1:8200/*';

describe('extension manifest', () => {
  it('requests no cookie, debugger, scripting or network-interception access', () => {
    const all = [...(manifest.permissions ?? []), ...(manifest.optional_permissions ?? []), ...(manifest.host_permissions ?? [])];
    for (const banned of ['cookies', 'debugger', 'webRequest', 'webRequestBlocking', 'scripting', 'downloads', '<all_urls>']) {
      expect(all).not.toContain(banned);
    }
    expect(manifest.externally_connectable).toBeUndefined();
  });

  it('limits host access and the content script to the Flow origin', () => {
    expect(manifest.host_permissions).toEqual([FLOW, BRIDGE]);
    expect(manifest.content_scripts).toHaveLength(1);
    expect(manifest.content_scripts[0].matches).toEqual([FLOW]);
    expect(manifest.content_scripts[0].js).toEqual(['content-flow.js']);
  });

  it('forbids remote scripts', () => {
    const csp = manifest.content_security_policy?.extension_pages as string;
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/https?:|unsafe-eval|unsafe-inline/);
  });
});
