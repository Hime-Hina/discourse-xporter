import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectImageAssets,
  downloadImageAssets,
  joinVaultPath,
  normalizeVaultPath,
  rewriteImageUrlsForObsidian,
  rewriteImageUrlsForZip,
  uploadImageAssets,
} from '../src/export/image-assets';
import { DEFAULTS } from '../src/config/defaults';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('image assets', () => {
  it('deduplicates filenames for different URLs with the same basename', () => {
    const markdown = [
      '![one](https://cdn.example.com/a/image.png)',
      '![two](https://cdn.example.com/b/image.png)',
      '![again](https://cdn.example.com/a/image.png)',
    ].join('\n');

    const assets = collectImageAssets(markdown);

    expect(assets.get('https://cdn.example.com/a/image.png')?.filename).toBe(
      'image.png',
    );
    expect(assets.get('https://cdn.example.com/b/image.png')?.filename).toBe(
      'image-2.png',
    );
    expect(assets.size).toBe(2);
  });

  it('uses one asset map for ZIP and Obsidian rewrites', () => {
    const markdown = '![a|b](https://cdn.example.com/a/image.png)';
    const assets = collectImageAssets(markdown);

    expect(rewriteImageUrlsForZip(markdown, assets, 'attachments', 123)).toBe(
      '![a|b](attachments/123/image.png)',
    );
    expect(
      rewriteImageUrlsForObsidian(markdown, assets, 'attachments', 123),
    ).toBe('![[attachments/123/image.png|a&#124;b]]');
  });

  it('normalizes Markdown-escaped image labels before Obsidian alias escaping', () => {
    const markdown = String.raw`![【官方订阅gpt pro20x】\|低价 \(教程\)](https://cdn.example.com/a/image.png)`;
    const assets = collectImageAssets(markdown);

    expect(
      rewriteImageUrlsForObsidian(markdown, assets, 'attachments', 123),
    ).toBe(
      String.raw`![[attachments/123/image.png|【官方订阅gpt pro20x】&#124;低价 (教程)]]`,
    );
  });

  it('escapes brackets and pipes in Obsidian image aliases', () => {
    const markdown = String.raw`![a\]b|c](https://cdn.example.com/a/image.png)`;
    const assets = collectImageAssets(markdown);

    expect(
      rewriteImageUrlsForObsidian(markdown, assets, 'attachments', 123),
    ).toBe(String.raw`![[attachments/123/image.png|a\]b&#124;c]]`);
  });

  it('fails image downloads instead of returning a partial asset map', async () => {
    const markdown = '![image](https://cdn.example.com/a/image.png)';
    const assets = collectImageAssets(markdown);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 }) as Response),
    );

    await expect(
      downloadImageAssets(assets, { ...DEFAULTS, imageConcurrency: 1 }),
    ).rejects.toThrow('Image download failed');
  });

  it('fails image uploads when the vault write fails', async () => {
    const markdown = '![image](https://cdn.example.com/a/image.png)';
    const assets = collectImageAssets(markdown);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      }) as Response),
    );
    vi.stubGlobal('GM_xmlhttpRequest', (request: {
      onload: (response: { status: number; responseText: string }) => void;
    }) => {
      request.onload({ status: 500, responseText: '' });
    });

    await expect(
      uploadImageAssets(
        assets,
        { apiUrl: 'https://127.0.0.1:27124', apiKey: 'key' },
        { ...DEFAULTS, imageConcurrency: 1 },
        'attachments',
        123,
      ),
    ).rejects.toThrow('Image upload failed');
  });

  it('normalizes vault paths and removes dangerous segments', () => {
    expect(normalizeVaultPath('../Discourse//C:/../attachments')).toBe(
      'Discourse/attachments',
    );
    expect(joinVaultPath('Discourse', '..', 'attachments', 'a:b.png')).toBe(
      'Discourse/attachments/a_b.png',
    );
  });
});
