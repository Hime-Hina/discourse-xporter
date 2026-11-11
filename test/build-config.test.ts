import { afterEach, describe, expect, it, vi } from 'vitest';
import { build, createServer, type ViteDevServer } from 'vite';
import { version } from '../package.json';

const configFile = 'vite.config.ts';
let server: ViteDevServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.unstubAllEnvs();
});

describe('userscript build boundary', () => {
  it('serves only the intended dev entry and handles preflight/HEAD without HMR', async () => {
    server = await createServer({
      configFile,
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, strictPort: true, open: false },
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing dev HTTP address');
    const url = `http://127.0.0.1:${address.port}/__vite-plugin-monkey.entry.js`;
    const get = await fetch(url);
    expect(get.status).toBe(200);
    expect(await get.text()).toBe(
      'import "/__vite-plugin-monkey.gm.api.js";\nimport "/src/main.ts";\n',
    );
    expect(get.headers.get('cross-origin-resource-policy')).toBe(
      'cross-origin',
    );
    expect(get.headers.get('access-control-allow-origin')).toBe('*');
    expect(get.headers.get('access-control-allow-private-network')).toBe(
      'true',
    );
    const head = await fetch(url, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe('application/javascript');
    expect(await head.text()).toBe('');
    const preflight = await fetch(url, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-methods')).toBe(
      'GET,HEAD,OPTIONS',
    );
    expect(await preflight.text()).toBe('');
  });

  it('emits project metadata and no development bridge or HMR in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const built = await build({
      configFile,
      logLevel: 'silent',
      build: { write: false },
    });
    const bundles = Array.isArray(built) ? built : [built];
    const script = bundles
      .flatMap((bundle) => ('output' in bundle ? bundle.output : []))
      .find((asset) => asset.fileName === 'discourse-xporter.user.js');
    if (!script || script.type !== 'chunk')
      throw new Error('Missing production userscript');
    expect(script.code).toMatch(
      new RegExp(`@version\\s+${version.replaceAll('.', '\\.')}(?:\\n|\\r)`),
    );
    expect(script.code).toMatch(
      /@namespace\s+https:\/\/github.com\/Hime-Hina\/discourse-xporter/,
    );
    expect(script.code).toMatch(/@author\s+Hime-Hina/);
    expect(script.code).toMatch(/@sandbox\s+DOM/);
    expect(script.code).not.toMatch(/@connect\s+\*/);
    expect(script.code).not.toContain('__vite-plugin-monkey.entry');
    expect(script.code).not.toContain('__vite-plugin-monkey.gm.api');
    expect(script.code).not.toContain('/@vite/client');
    expect(script.code).not.toContain('127.0.0.1:5173');
    expect(script.code.includes('dxp_dev_config')).toBe(false);
  });
});
