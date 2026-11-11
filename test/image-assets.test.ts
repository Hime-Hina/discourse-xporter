import { afterEach, describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import {
  collectImageAssets,
  downloadImageAssets,
  rewriteImageUrlsForObsidian,
  rewriteImageUrlsForZip,
  stripImages,
  uploadImageAssets,
  buildImageZip,
} from '../src/export/image-assets';
import {
  joinVaultPath,
  normalizeVaultPath,
  siteKey,
  topicPaths,
} from '../src/export/paths';
import { DEFAULTS } from '../src/config/defaults';
import { installMemoryVault } from './vault-fixture';
import { UncertainWriteError } from '../src/export/obsidian-api';

const settings = { ...DEFAULTS, imageDelayMin: 0, imageDelayMax: 0 };
const connection = {
  apiUrl: 'https://127.0.0.1:27124',
  apiKey: 'SYNTHETIC_KEY',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function imageResponse(text: string): Response {
  return new Response(text);
}

describe('immutable image assets', () => {
  it('allocates content names independent of basename collisions, case and source order', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => imageResponse(url)),
    );
    const urls = [
      'https://cdn.example/a/image.png',
      'https://cdn.example/b/IMAGE.png',
      'https://cdn.example/c/image-2.png',
    ];
    const markdown = urls.map((url) => `![image](${url})`).join('\n');
    const first = collectImageAssets(markdown);
    const images = await downloadImageAssets(first, settings);
    expect(
      new Set([...first.values()].map((asset) => asset.filename)).size,
    ).toBe(3);
    const reordered = collectImageAssets(
      urls
        .slice()
        .reverse()
        .map((url) => `![image](${url})`)
        .join('\n'),
    );
    await downloadImageAssets(reordered, settings);
    for (const url of urls)
      expect(reordered.get(url)?.filename).toBe(first.get(url)?.filename);
    const rewritten = rewriteImageUrlsForZip(
      markdown,
      first,
      'attachments/site/10',
    );
    const zip = unzipSync(
      buildImageZip(rewritten, 'note', 'attachments/site/10', images),
    );
    expect(Object.keys(zip)).toHaveLength(4);
    expect(strFromU8(zip['note.md'])).toBe(rewritten);
    for (const filename of images.keys())
      expect(zip[`attachments/site/10/${filename}`]).toBeDefined();
  });

  it('shares exact image references across ZIP, Obsidian, references, titles and escaped aliases', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => imageResponse('bytes')),
    );
    const markdown = String.raw`![a\]b|c](https://cdn.example/file(2).png "title")
![same][ref]
[ref]: <https://cdn.example/file(2).png>`;
    const assets = collectImageAssets(markdown);
    await downloadImageAssets(assets, settings);
    expect(assets.size).toBe(1);
    const name = [...assets.values()][0].filename;
    expect(rewriteImageUrlsForObsidian(markdown, assets, 'assets')).toContain(
      String.raw`![[assets/${name}|a\]b&#124;c]]`,
    );
    expect(
      rewriteImageUrlsForZip(markdown, assets, 'assets').match(
        new RegExp(name.replace('.', '\\.'), 'g'),
      ),
    ).toHaveLength(2);
    expect(stripImages(markdown)).toContain('a]b|c\nsame');
  });

  it('preserves code examples and makes unsupported file image syntax explicit', () => {
    const markdown =
      '`![example](https://cdn.example/a.png)`\n\n~~~\n![code](https://cdn.example/b.png)\n~~~';
    expect(collectImageAssets(markdown).size).toBe(0);
    expect(stripImages(markdown)).toBe(markdown);
    expect(() =>
      collectImageAssets('<img src="https://cdn.example/a.png">'),
    ).toThrow('HTML image');
    expect(() => collectImageAssets('![x](data:image/png;base64,abc)')).toThrow(
      'Unsupported image',
    );
  });

  it('waits for in-flight downloads before failing and never schedules the next chunk', async () => {
    let release!: (response: Response) => void;
    const fetch = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
      )
      .mockResolvedValueOnce(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    const assets = collectImageAssets(
      '![one](https://cdn.example/a.png)\n![two](https://cdn.example/b.png)\n![three](https://cdn.example/c.png)',
    );
    let finished = false;
    const operation = downloadImageAssets(assets, {
      ...settings,
      imageConcurrency: 2,
    }).finally(() => {
      finished = true;
    });
    const rejected = expect(operation).rejects.toThrow('Image download failed');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(finished).toBe(false);
    release(imageResponse('first'));
    await rejected;
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('skips byte-confirmed attachments and preserves old bytes when a URL changes', async () => {
    const vault = installMemoryVault();
    let bytes = 'old';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => imageResponse(bytes)),
    );
    const first = collectImageAssets('![image](https://cdn.example/a.png)');
    await uploadImageAssets(first, connection, settings, 'assets/site/10');
    const oldName = [...first.values()][0].filename;
    const putCount = () =>
      vault.requests.filter((request) => request.method === 'PUT').length;
    expect(putCount()).toBe(1);
    await uploadImageAssets(
      collectImageAssets('![image](https://cdn.example/a.png)'),
      connection,
      settings,
      'assets/site/10',
    );
    expect(putCount()).toBe(1);
    bytes = 'new';
    const next = collectImageAssets('![image](https://cdn.example/a.png)');
    await uploadImageAssets(next, connection, settings, 'assets/site/10');
    expect([...next.values()][0].filename).not.toBe(oldName);
    expect(vault.files.get(`assets/site/10/${oldName}`)).toEqual(
      new TextEncoder().encode('old'),
    );
    expect(putCount()).toBe(2);
  });

  it('does not hide an uncertain PUT behind a parallel cancelled read', async () => {
    const controller = new AbortController();
    const vault = installMemoryVault();
    let binaryReads = 0;
    vault.override.handle = (request) => {
      if (request.method === 'GET' && request.responseType === 'arraybuffer') {
        binaryReads++;
        // The first resource is still being checked when the second PUT is accepted.
        if (binaryReads === 1) return true;
      }
      if (request.method === 'PUT') return true;
      return false;
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => imageResponse(url)),
    );
    const assets = collectImageAssets(
      '![a](https://cdn.example/a.png)\n![b](https://cdn.example/b.png)',
    );
    const operation = uploadImageAssets(
      assets,
      connection,
      { ...settings, imageConcurrency: 2 },
      'assets',
      undefined,
      controller.signal,
    );
    const rejected =
      expect(operation).rejects.toBeInstanceOf(UncertainWriteError);
    await vi.waitFor(() =>
      expect(
        vault.requests.filter((request) => request.method === 'PUT'),
      ).toHaveLength(1),
    );
    controller.abort();
    await rejected;
  });

  it('keeps old resources when a later download fails', async () => {
    const vault = installMemoryVault({ 'assets/old.png': new Uint8Array([1]) });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('fail.png')
          ? new Response('', { status: 404 })
          : imageResponse('new'),
      ),
    );
    await expect(
      uploadImageAssets(
        collectImageAssets(
          '![ok](https://cdn.example/ok.png)\n![fail](https://cdn.example/fail.png)',
        ),
        connection,
        settings,
        'assets',
      ),
    ).rejects.toThrow('Image download failed');
    expect(
      vault.requests.filter((request) => request.method === 'PUT'),
    ).toHaveLength(0);
    expect(vault.files.get('assets/old.png')).toEqual(new Uint8Array([1]));
  });
});

describe('vault path and source isolation', () => {
  it('normalizes paths once and separates scheme, port, IPv6 and trailing-dot origins', () => {
    expect(normalizeVaultPath('../Discourse//C:/../attachments')).toBe(
      'Discourse/attachments',
    );
    expect(joinVaultPath('Discourse', '..', 'attachments', 'a:b.png')).toBe(
      'Discourse/attachments/a_b.png',
    );
    const origins = [
      'https://example.com',
      'http://example.com',
      'https://example.com:8443',
      'https://example.com.',
      'https://example.com..',
      'http://[::1]:8080',
    ];
    expect(
      new Set(
        origins.map(
          (origin) => topicPaths(settings, origin, 10, 'same').notePath,
        ),
      ).size,
    ).toBe(origins.length);
    expect(siteKey('https://EXAMPLE.com:443')).toBe(
      siteKey('https://example.com'),
    );
    expect(
      topicPaths(
        { ...settings, imgDirMode: 'absolute', imgDir: '/all//images' },
        'https://example.com',
        10,
        'same',
      ).imageDir,
    ).toBe('all/images/https--example.com/10');
  });
});
