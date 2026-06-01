import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS } from '../src/config/defaults';
import type { TopicExportResult } from '../src/core/topic-export';
import { downloadFile } from '../src/export/download';
import {
  buildImageZip,
  collectImageAssets,
  downloadImageAssets,
  downloadZipBytes,
  rewriteImageUrlsForObsidian,
  rewriteImageUrlsForZip,
  stripImages,
  uploadImageAssets,
} from '../src/export/image-assets';
import {
  openNote,
  testConnection,
  writeNote,
} from '../src/export/obsidian-api';
import {
  downloadTopicMarkdown,
  downloadTopicZip,
  overwriteTopicObsidianNote,
  writeTopicToConfiguredObsidian,
} from '../src/export/topic-delivery';
import type {
  DiscoursePost,
  DiscourseTopic,
  ProcessedPost,
} from '../src/types';

vi.mock('../src/export/download', () => ({
  downloadFile: vi.fn(),
}));

vi.mock('../src/export/image-assets', () => ({
  buildImageZip: vi.fn(),
  collectImageAssets: vi.fn(),
  downloadImageAssets: vi.fn(),
  downloadZipBytes: vi.fn(),
  joinVaultPath: (...parts: string[]) => parts.filter(Boolean).join('/'),
  resolveImgDir: vi.fn(() => 'Discourse/attachments'),
  rewriteImageUrlsForObsidian: vi.fn(),
  rewriteImageUrlsForZip: vi.fn(),
  stripImages: vi.fn(),
  uploadImageAssets: vi.fn(),
}));

vi.mock('../src/export/obsidian-api', () => ({
  openNote: vi.fn(),
  testConnection: vi.fn(),
  writeNote: vi.fn(),
}));

function topicExportResult(markdown = 'Topic body'): TopicExportResult {
  return {
    topic: {} as DiscourseTopic,
    allPosts: [] as DiscoursePost[],
    processedPosts: [] as ProcessedPost[],
    markdown,
    safeTitle: 'Topic Title',
    topicId: 123,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(buildImageZip).mockReturnValue(new Uint8Array([1, 2, 3]));
  vi.mocked(collectImageAssets).mockReturnValue(new Map());
  vi.mocked(downloadImageAssets).mockResolvedValue(new Map());
  vi.mocked(rewriteImageUrlsForObsidian).mockReturnValue('obsidian markdown');
  vi.mocked(rewriteImageUrlsForZip).mockReturnValue('zip markdown');
  vi.mocked(stripImages).mockReturnValue('stripped markdown');
  vi.mocked(testConnection).mockResolvedValue(true);
  vi.mocked(uploadImageAssets).mockResolvedValue(undefined);
  vi.mocked(writeNote).mockResolvedValue(undefined);
  vi.mocked(openNote).mockResolvedValue(undefined);
});

describe('topic delivery', () => {
  it('downloads a Markdown export directly', () => {
    const exportData = topicExportResult();

    downloadTopicMarkdown(exportData);

    expect(downloadFile).toHaveBeenCalledWith(
      'Topic body',
      'Topic Title.md',
      'text/markdown;charset=utf-8',
    );
  });

  it('falls back to a Markdown download when ZIP export has no images', async () => {
    const delivery = await downloadTopicZip(topicExportResult('No images'), {
      ...DEFAULTS,
    });

    expect(delivery).toEqual({ downloadedFileKind: 'markdown' });
    expect(downloadFile).toHaveBeenCalledWith(
      'No images',
      'Topic Title.md',
      'text/markdown;charset=utf-8',
    );
    expect(downloadZipBytes).not.toHaveBeenCalled();
  });

  it('materializes images before downloading a ZIP archive', async () => {
    const imageAssets = new Map([
      [
        'https://cdn.example.com/image.png',
        {
          url: 'https://cdn.example.com/image.png',
          filename: 'image.png',
        },
      ],
    ]);
    vi.mocked(collectImageAssets).mockReturnValue(imageAssets);
    vi.mocked(downloadImageAssets).mockResolvedValue(
      new Map([['image.png', new Uint8Array([9])]]),
    );

    const delivery = await downloadTopicZip(
      topicExportResult('![img](https://cdn.example.com/image.png)'),
      { ...DEFAULTS },
    );

    expect(delivery).toEqual({ downloadedFileKind: 'zip' });
    expect(rewriteImageUrlsForZip).toHaveBeenCalledWith(
      '![img](https://cdn.example.com/image.png)',
      imageAssets,
      'Discourse/attachments',
      123,
    );
    expect(buildImageZip).toHaveBeenCalledWith(
      'zip markdown',
      'Topic Title',
      123,
      expect.any(Object),
      expect.any(Map),
    );
    expect(downloadZipBytes).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
      'Topic Title',
    );
  });

  it('rejects configured Obsidian writes without an API key', async () => {
    await expect(
      writeTopicToConfiguredObsidian(topicExportResult(), {
        ...DEFAULTS,
        obsApiKey: '',
      }),
    ).rejects.toThrow('请先配置 Obsidian API Key');

    expect(testConnection).not.toHaveBeenCalled();
    expect(writeNote).not.toHaveBeenCalled();
  });

  it('writes stripped Markdown to Obsidian for no-image mode', async () => {
    await writeTopicToConfiguredObsidian(topicExportResult('![x](url)'), {
      ...DEFAULTS,
      obsApiKey: 'secret',
      imgMode: 'none',
      obsOpenAfterExport: true,
    });

    expect(testConnection).toHaveBeenCalledWith({
      apiUrl: DEFAULTS.obsApiUrl,
      apiKey: 'secret',
    });
    expect(stripImages).toHaveBeenCalledWith('![x](url)');
    expect(writeNote).toHaveBeenCalledWith(
      { apiUrl: DEFAULTS.obsApiUrl, apiKey: 'secret' },
      'Discourse/Topic Title.md',
      'stripped markdown',
    );
    expect(openNote).toHaveBeenCalledWith(
      { apiUrl: DEFAULTS.obsApiUrl, apiKey: 'secret' },
      'Discourse/Topic Title.md',
    );
  });

  it('uploads file-mode images before overwriting an Obsidian note', async () => {
    const imageAssets = new Map([
      [
        'https://cdn.example.com/image.png',
        {
          url: 'https://cdn.example.com/image.png',
          filename: 'image.png',
        },
      ],
    ]);
    vi.mocked(collectImageAssets).mockReturnValue(imageAssets);

    await overwriteTopicObsidianNote(
      topicExportResult('![img](https://cdn.example.com/image.png)'),
      { ...DEFAULTS, imgMode: 'file' },
      { apiUrl: DEFAULTS.obsApiUrl, apiKey: 'secret' },
      'Discourse/Existing.md',
    );

    expect(uploadImageAssets).toHaveBeenCalledWith(
      imageAssets,
      { apiUrl: DEFAULTS.obsApiUrl, apiKey: 'secret' },
      expect.any(Object),
      'Discourse/attachments',
      123,
      undefined,
    );
    expect(rewriteImageUrlsForObsidian).toHaveBeenCalledWith(
      '![img](https://cdn.example.com/image.png)',
      imageAssets,
      'Discourse/attachments',
      123,
    );
    expect(writeNote).toHaveBeenCalledWith(
      { apiUrl: DEFAULTS.obsApiUrl, apiKey: 'secret' },
      'Discourse/Existing.md',
      'obsidian markdown',
    );
  });
});
