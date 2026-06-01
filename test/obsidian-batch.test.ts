import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS } from '../src/config/defaults';
import { buildTopicExport } from '../src/core/topic-export';
import {
  reExportObsidianNotes,
  scanExportedNotesByOrigin,
} from '../src/export/obsidian-batch';
import { getNoteMetadata, searchByOrigin } from '../src/export/obsidian-api';
import { overwriteTopicObsidianNote } from '../src/export/topic-delivery';
import { sleepRandom } from '../src/utils/timing';
import type { TopicExportResult } from '../src/core/topic-export';
import type {
  DiscoursePost,
  DiscourseTopic,
  ProcessedPost,
} from '../src/types';

vi.mock('../src/core/topic-export', () => ({
  buildTopicExport: vi.fn(),
}));

vi.mock('../src/export/obsidian-api', () => ({
  getNoteMetadata: vi.fn(),
  searchByOrigin: vi.fn(),
}));

vi.mock('../src/export/topic-delivery', () => ({
  overwriteTopicObsidianNote: vi.fn(),
}));

vi.mock('../src/utils/timing', () => ({
  sleepRandom: vi.fn(),
}));

function topicExportResult(): TopicExportResult {
  return {
    topic: {} as DiscourseTopic,
    allPosts: [] as DiscoursePost[],
    processedPosts: [] as ProcessedPost[],
    markdown: 'markdown',
    safeTitle: 'Topic Title',
    topicId: 123,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.mocked(buildTopicExport).mockResolvedValue(topicExportResult());
  vi.mocked(getNoteMetadata).mockResolvedValue(null);
  vi.mocked(searchByOrigin).mockResolvedValue([]);
  vi.mocked(overwriteTopicObsidianNote).mockResolvedValue(undefined);
  vi.mocked(sleepRandom).mockResolvedValue(undefined);
});

describe('obsidian batch export', () => {
  it('scans exported notes and drops files without xporter metadata', async () => {
    vi.mocked(searchByOrigin).mockResolvedValue(['one.md', 'scratch.md']);
    vi.mocked(getNoteMetadata).mockImplementation(async (_apiConfig, path) => {
      if (path === 'one.md') {
        return {
          path: 'one.md',
          title: 'One',
          topicId: 101,
          xporterVersion: 1,
        };
      }
      return null;
    });

    await expect(
      scanExportedNotesByOrigin(
        { apiUrl: DEFAULTS.obsApiUrl, apiKey: 'secret' },
        'https://example.com',
      ),
    ).resolves.toEqual([
      {
        path: 'one.md',
        title: 'One',
        topicId: 101,
        xporterVersion: 1,
      },
    ]);
  });

  it('rebuilds each note and overwrites the original vault path', async () => {
    const onProgress = vi.fn();

    const summary = await reExportObsidianNotes({
      items: [
        {
          path: 'Discourse/Existing.md',
          title: 'Existing',
          topicId: 123,
          xporterVersion: 1,
        },
      ],
      config: { ...DEFAULTS },
      apiConfig: { apiUrl: DEFAULTS.obsApiUrl, apiKey: 'secret' },
      origin: 'https://example.com',
      forumName: 'Example',
      formatVersion: 2,
      onProgress,
    });

    expect(summary).toEqual({ success: 1, failed: 0 });
    expect(onProgress).toHaveBeenCalledWith(1, 1, 'Existing');
    expect(buildTopicExport).toHaveBeenCalledWith({
      topicId: 123,
      origin: 'https://example.com',
      forumName: 'Example',
      formatVersion: 2,
      config: expect.any(Object),
    });
    expect(overwriteTopicObsidianNote).toHaveBeenCalledWith(
      topicExportResult(),
      expect.any(Object),
      { apiUrl: DEFAULTS.obsApiUrl, apiKey: 'secret' },
      'Discourse/Existing.md',
    );
  });

  it('retries one rate-limited re-export before counting success', async () => {
    vi.mocked(overwriteTopicObsidianNote)
      .mockRejectedValueOnce(new Error('HTTP 429'))
      .mockResolvedValueOnce(undefined);

    const summary = await reExportObsidianNotes({
      items: [
        {
          path: 'Discourse/Existing.md',
          title: 'Existing',
          topicId: 123,
          xporterVersion: 1,
        },
      ],
      config: { ...DEFAULTS, batchDelayMax: 7 },
      apiConfig: { apiUrl: DEFAULTS.obsApiUrl, apiKey: 'secret' },
      origin: 'https://example.com',
      forumName: 'Example',
      formatVersion: 2,
      onProgress: vi.fn(),
    });

    expect(summary).toEqual({ success: 1, failed: 0 });
    expect(sleepRandom).toHaveBeenCalledWith(14, 14);
    expect(overwriteTopicObsidianNote).toHaveBeenCalledTimes(2);
  });

  it('counts non-rate-limited re-export failures', async () => {
    vi.mocked(overwriteTopicObsidianNote).mockRejectedValue(
      new Error('HTTP 500'),
    );

    const summary = await reExportObsidianNotes({
      items: [
        {
          path: 'Discourse/Existing.md',
          title: 'Existing',
          topicId: 123,
          xporterVersion: 1,
        },
      ],
      config: { ...DEFAULTS },
      apiConfig: { apiUrl: DEFAULTS.obsApiUrl, apiKey: 'secret' },
      origin: 'https://example.com',
      forumName: 'Example',
      formatVersion: 2,
      onProgress: vi.fn(),
    });

    expect(summary).toEqual({ success: 0, failed: 1 });
  });
});
