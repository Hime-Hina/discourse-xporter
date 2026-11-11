import { afterEach, describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { DEFAULTS } from '../src/config/defaults';
import type { TopicExportResult } from '../src/core/topic-export';
import { downloadFile } from '../src/export/download';
import {
  downloadTopicMarkdown,
  downloadTopicZip,
  overwriteTopicObsidianNote,
  refreshObsidianNoteLinks,
  writeTopicToConfiguredObsidian,
} from '../src/export/topic-delivery';
import { topicPaths } from '../src/export/paths';
import { exportedNote, installMemoryVault } from './vault-fixture';

vi.mock('../src/export/download', () => ({ downloadFile: vi.fn() }));
const connection = { apiUrl: DEFAULTS.obsApiUrl, apiKey: 'SYNTHETIC_KEY' };
const settings = {
  ...DEFAULTS,
  obsApiKey: connection.apiKey,
  obsOpenAfterExport: false,
  imageDelayMin: 0,
  imageDelayMax: 0,
  imgMode: 'embed' as const,
};
function document(
  topicId = 10,
  origin = 'https://forum.example',
  body = 'body',
  title = 'Same Title',
): TopicExportResult {
  return {
    topicId,
    origin,
    safeTitle: title,
    markdown: exportedNote(topicId, body, origin, title),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('document delivery contracts through real GM and image boundaries', () => {
  it('separates same titles, sanitized titles and different sites, including attachments', async () => {
    const vault = installMemoryVault();
    const documents = [
      document(10),
      document(11),
      document(10, 'https://other.example'),
    ];
    for (const entry of documents)
      await writeTopicToConfiguredObsidian(entry, settings);
    const paths = documents.map(
      (entry) =>
        topicPaths(settings, entry.origin, entry.topicId, entry.safeTitle)
          .notePath,
    );
    expect(new Set(paths).size).toBe(3);
    for (let index = 0; index < paths.length; index++)
      expect(vault.files.get(paths[index])).toBe(documents[index].markdown);
  });

  it('keeps the original note path after title changes and rejects occupied foreign paths', async () => {
    const old = document();
    const vault = installMemoryVault({ 'Legacy/old-name.md': old.markdown });
    await writeTopicToConfiguredObsidian(
      document(10, old.origin, 'updated', 'New Title'),
      settings,
    );
    expect(String(vault.files.get('Legacy/old-name.md'))).toContain('updated');
    expect([...vault.files.keys()]).toEqual(['Legacy/old-name.md']);
    const target = topicPaths(settings, old.origin, 20, 'Same Title').notePath;
    vault.files.set(target, 'ordinary note owned by the user');
    await expect(
      writeTopicToConfiguredObsidian(document(20), settings),
    ).rejects.toThrow('Refusing to overwrite');
    expect(vault.files.get(target)).toBe('ordinary note owned by the user');
    await expect(
      overwriteTopicObsidianNote(
        document(99),
        settings,
        connection,
        'Legacy/old-name.md',
      ),
    ).rejects.toThrow('Refusing to overwrite');
  });

  it('refuses to guess between two saved strategies of the same topic', async () => {
    installMemoryVault({
      'first.md': document().markdown,
      'second.md': document().markdown,
    });
    await expect(
      writeTopicToConfiguredObsidian(document(), settings),
    ).rejects.toThrow('Multiple exported notes');
  });

  it('waits for required pictures before writing a note and preserves all old bytes on failure', async () => {
    const path = topicPaths(
      settings,
      'https://forum.example',
      10,
      'Same Title',
    ).notePath;
    const oldMarkdown = exportedNote(10, '![[old/A.png]]\n![[old/B.png]]');
    const vault = installMemoryVault({
      [path]: oldMarkdown,
      'old/A.png': new Uint8Array([1]),
      'old/B.png': new Uint8Array([2]),
    });
    let release!: (value: Response) => void;
    const fetch = vi.fn((url: string) =>
      url.endsWith('new.png')
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : Promise.resolve(new Response('B')),
    );
    vi.stubGlobal('fetch', fetch);
    const writing = writeTopicToConfiguredObsidian(
      document(
        10,
        'https://forum.example',
        '![B](https://cdn.example/B.png)\n![new](https://cdn.example/new.png)',
      ),
      { ...settings, imgMode: 'file' },
    );
    const rejected = expect(writing).rejects.toThrow('Image download failed');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(
      vault.requests.filter((request) => request.method === 'PUT'),
    ).toHaveLength(0);
    release(new Response('', { status: 404 }));
    await rejected;
    expect(vault.files.get(path)).toBe(oldMarkdown);
    expect(vault.files.get('old/A.png')).toEqual(new Uint8Array([1]));
    expect(vault.files.get('old/B.png')).toEqual(new Uint8Array([2]));
  });

  it('delivers content-addressed assets before the note, then skips unchanged writes', async () => {
    const vault = installMemoryVault();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('image bytes')),
    );
    const entry = document(
      10,
      'https://forum.example',
      '![alt](https://cdn.example/image.png)',
    );
    expect(
      await writeTopicToConfiguredObsidian(entry, {
        ...settings,
        imgMode: 'file',
      }),
    ).toEqual({ updated: true });
    const puts = vault.requests.filter((request) => request.method === 'PUT');
    expect(puts).toHaveLength(2);
    expect(puts[0].data).toBeInstanceOf(ArrayBuffer);
    expect(typeof puts[1].data).toBe('string');
    const body = String(puts[1].data);
    expect(body).toMatch(
      /!\[\[Discourse\/attachments\/https--forum.example\/10\/[a-f0-9]{64}\.png\|alt\]\]/,
    );
    const next = {
      ...entry,
      markdown: entry.markdown.replace('2026-01-01', '2026-01-02'),
    };
    expect(
      await writeTopicToConfiguredObsidian(next, {
        ...settings,
        imgMode: 'file',
      }),
    ).toEqual({ updated: false });
    expect(
      vault.requests.filter((request) => request.method === 'PUT'),
    ).toHaveLength(2);
  });

  it('reports note commit success even when opening Obsidian subsequently fails', async () => {
    const vault = installMemoryVault();
    vault.override.handle = (request) => {
      if (!request.url.includes('/open/')) return false;
      request.onload({ status: 500, responseText: '' });
      return true;
    };
    expect(
      await writeTopicToConfiguredObsidian(document(), {
        ...settings,
        obsOpenAfterExport: true,
      }),
    ).toEqual({
      updated: true,
      openFailed: 'Obsidian API open failed: HTTP 500',
    });
    expect([...vault.files.values()]).toContain(document().markdown);
  });

  it('produces portable ZIP entries matching the final rewritten references', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('image')),
    );
    const entry = document(
      10,
      'https://forum.example',
      '![image](https://cdn.example/image(2).png "title")',
    );
    expect(await downloadTopicZip(entry, settings)).toEqual({
      downloadedFileKind: 'zip',
    });
    const blob = vi.mocked(downloadFile).mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    if (!(blob instanceof Blob)) throw new Error('Expected ZIP blob');
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const body = strFromU8(zip['Same Title.md']);
    const destination = body.match(/!\[image\]\(<([^>]+)>\)/)?.[1];
    expect(destination).toBeDefined();
    expect(zip[destination!]).toBeDefined();
    expect(Object.keys(zip)).toHaveLength(2);
  });

  it('keeps Markdown source images and removes file-mode images in none mode without touching code', async () => {
    const entry = document(
      10,
      'https://forum.example',
      '![body](https://cdn.example/image.png)\n`![example](https://cdn.example/code.png)`',
    );
    downloadTopicMarkdown(entry);
    expect(vi.mocked(downloadFile).mock.calls[0][0]).toBe(entry.markdown);
    const vault = installMemoryVault();
    await writeTopicToConfiguredObsidian(entry, {
      ...settings,
      imgMode: 'none',
    });
    const body = String([...vault.files.values()][0]);
    expect(body).toContain('\nbody\n`![example]');
    expect(body).not.toContain('![body]');
  });

  it('refreshes links only in selected exported notes and leaves unrelated vault files unchanged', async () => {
    const a = document(
      10,
      'https://forum.example',
      '[target](https://forum.example/t/topic/20/5)',
    );
    const b = document(20, 'https://forum.example', '## #5 ^floor-5');
    const vault = installMemoryVault({
      'a.md': a.markdown,
      'renamed-b.md': b.markdown,
      'personal.md': '[private](https://forum.example/t/topic/20/5)',
    });
    const selected = [
      {
        path: 'a.md',
        title: 'Same Title',
        topicId: 10,
        xporterVersion: 2,
        source: 'https://forum.example/t/topic/10',
      },
    ];
    expect(
      await refreshObsidianNoteLinks(connection, a.origin, selected),
    ).toEqual({ updated: 1, ambiguous: 0 });
    expect(vault.files.get('a.md')).toContain('[[renamed-b#^floor-5|target]]');
    expect(vault.files.get('personal.md')).toBe(
      '[private](https://forum.example/t/topic/20/5)',
    );
    expect(
      await refreshObsidianNoteLinks(connection, a.origin, selected),
    ).toEqual({ updated: 0, ambiguous: 0 });
  });
});
