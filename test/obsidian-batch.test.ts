import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS } from '../src/config/defaults';
import { buildTopicExport } from '../src/core/topic-export';
import { buildExportProfile } from '../src/core/export-profile';
import {
  reExportObsidianNotes,
  scanExportedNotesByOrigin,
} from '../src/export/obsidian-batch';
import { getNoteMetadata, searchByOrigin } from '../src/export/obsidian-api';
import { overwriteTopicObsidianNote } from '../src/export/topic-delivery';
import { sleepRandom } from '../src/utils/timing';
import type { ObsidianBatchReExportRequest } from '../src/export/obsidian-batch';
import type { BatchItem, FilterConfig } from '../src/types';

vi.mock('../src/core/topic-export', () => ({ buildTopicExport: vi.fn() }));
vi.mock('../src/export/obsidian-api', () => ({
  getNoteMetadata: vi.fn(),
  searchByOrigin: vi.fn(),
}));
vi.mock('../src/export/topic-delivery', () => ({
  overwriteTopicObsidianNote: vi.fn(),
}));
vi.mock('../src/utils/timing', () => ({ sleepRandom: vi.fn() }));

const connection = { apiUrl: DEFAULTS.obsApiUrl, apiKey: 'SYNTHETIC_SECRET' };
function document() {
  return {
    markdown: 'markdown',
    safeTitle: 'Topic Title',
    topicId: 123,
    origin: 'https://example.com',
  };
}
function item(overrides: Partial<BatchItem> = {}): BatchItem {
  return {
    path: 'Discourse/Existing.md',
    title: 'Existing',
    topicId: 123,
    xporterVersion: 1,
    source: 'https://example.com/t/topic/123',
    exportProfile: buildExportProfile(DEFAULTS),
    ...overrides,
  };
}
function request(items: BatchItem[] = [item()]): ObsidianBatchReExportRequest {
  return {
    items,
    config: { ...DEFAULTS, batchDelayMin: 0, batchDelayMax: 0 },
    apiConfig: { ...connection },
    origin: 'https://example.com',
    forumName: 'Example',
    formatVersion: 2,
    onProgress: vi.fn(),
  };
}
const filters: FilterConfig = {
  rangeMode: 'range',
  rangeStart: 3,
  rangeEnd: Infinity,
  onlyOp: false,
  imgFilter: 'none',
  users: ['Alice'],
  includeKeywords: [],
  excludeKeywords: [],
  minLength: 0,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(buildTopicExport).mockResolvedValue(document());
  vi.mocked(getNoteMetadata).mockResolvedValue(null);
  vi.mocked(searchByOrigin).mockResolvedValue([]);
  vi.mocked(overwriteTopicObsidianNote).mockResolvedValue({ updated: true });
  vi.mocked(sleepRandom).mockResolvedValue(undefined);
});

describe('obsidian batch export', () => {
  it('scans unique paths and skips valid notes without export metadata', async () => {
    vi.mocked(searchByOrigin).mockResolvedValue([
      'one.md',
      'scratch.md',
      'one.md',
    ]);
    vi.mocked(getNoteMetadata).mockImplementation(async (_connection, path) =>
      path === 'one.md' ? { ...item({ path }), content: 'markdown' } : null,
    );
    const notes = await scanExportedNotesByOrigin(
      connection,
      'https://example.com',
    );
    expect(notes).toEqual([item({ path: 'one.md' })]);
    expect(getNoteMetadata).toHaveBeenCalledTimes(2);
  });

  it.each([
    new Error('HTTP 401'),
    new Error('HTTP 500'),
    new SyntaxError('invalid JSON'),
  ])(
    'rejects an incomplete scan when metadata cannot be read: %s',
    async (error) => {
      vi.mocked(searchByOrigin).mockResolvedValue(['existing.md']);
      vi.mocked(getNoteMetadata).mockRejectedValue(error);
      await expect(
        scanExportedNotesByOrigin(connection, 'https://example.com'),
      ).rejects.toThrow('existing.md');
    },
  );

  it.each([
    item({ topicId: NaN }),
    item({ topicId: 0 }),
    item({ topicId: -1 }),
    item({ topicId: 1.5 }),
    item({ source: 'https://other.example/t/topic/123' }),
  ])(
    'rejects invalid or cross-site metadata before re-export: %o',
    async (invalid) => {
      vi.mocked(searchByOrigin).mockResolvedValue(['existing.md']);
      vi.mocked(getNoteMetadata).mockResolvedValue({
        ...invalid,
        content: 'markdown',
      });
      await expect(
        scanExportedNotesByOrigin(connection, 'https://example.com'),
      ).rejects.toThrow();
      const summary = await reExportObsidianNotes(request([invalid]));
      expect(summary.failed).toBe(1);
      expect(buildTopicExport).not.toHaveBeenCalled();
    },
  );

  it('restores each note policy and keeps connection settings from the current request', async () => {
    const firstProfile = buildExportProfile(
      { ...DEFAULTS, imgMode: 'none', floorTemplate: 'first {{content}}' },
      filters,
    );
    const secondFilters = {
      ...filters,
      rangeMode: 'selected' as const,
      users: ['Bob'],
    };
    const secondProfile = buildExportProfile(
      { ...DEFAULTS, imgMode: 'embed', floorTemplate: 'second {{content}}' },
      secondFilters,
      new Map([[9, 9001]]),
      new Set([9]),
    );
    const summary = await reExportObsidianNotes(
      request([
        item({ path: 'one.md', exportProfile: firstProfile }),
        item({ path: 'two.md', exportProfile: secondProfile }),
      ]),
    );
    expect(summary).toMatchObject({
      success: 2,
      failed: 0,
      updated: 2,
      unchanged: 0,
      cancelled: false,
    });
    expect(buildTopicExport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        filters,
        config: expect.objectContaining({
          imgMode: 'none',
          floorTemplate: 'first {{content}}',
          obsApiKey: DEFAULTS.obsApiKey,
        }),
      }),
    );
    expect(buildTopicExport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        filters: secondFilters,
        selectedPosts: new Set([9]),
        selectedPostIds: new Map([[9, 9001]]),
        config: expect.objectContaining({
          imgMode: 'embed',
          floorTemplate: 'second {{content}}',
        }),
      }),
    );
    expect(overwriteTopicObsidianNote).toHaveBeenNthCalledWith(
      2,
      document(),
      expect.any(Object),
      connection,
      'two.md',
      undefined,
      undefined,
    );
  });

  it('refuses legacy or unknown policies until an explicit replacement is supplied', async () => {
    const legacy = item({ exportProfile: undefined });
    const summary = await reExportObsidianNotes(request([legacy]));
    expect(summary).toMatchObject({ success: 0, failed: 1 });
    expect(summary.failures[0].message).toContain(
      'choose replacement settings',
    );
    expect(overwriteTopicObsidianNote).not.toHaveBeenCalled();
    const replacement = request([legacy]);
    replacement.profileOverride = buildExportProfile(
      { ...DEFAULTS, imgMode: 'none' },
      filters,
    );
    expect((await reExportObsidianNotes(replacement)).updated).toBe(1);
    expect(buildTopicExport).toHaveBeenCalledWith(
      expect.objectContaining({
        filters,
        config: expect.objectContaining({ imgMode: 'none' }),
      }),
    );
  });

  it('reports unchanged deliveries and preserves failures for an explicit retry', async () => {
    vi.mocked(overwriteTopicObsidianNote)
      .mockResolvedValueOnce({ updated: false })
      .mockRejectedValueOnce(new Error('HTTP 500'));
    const summary = await reExportObsidianNotes(
      request([item({ path: 'one.md' }), item({ path: 'two.md' })]),
    );
    expect(summary).toMatchObject({
      success: 1,
      updated: 0,
      unchanged: 1,
      failed: 1,
    });
    expect(summary.failures).toEqual([
      { path: 'two.md', title: 'Existing', message: 'HTTP 500' },
    ]);
    expect(summary.results).toEqual([
      { path: 'one.md', status: 'unchanged' },
      { path: 'two.md', status: 'failed' },
    ]);
  });

  it('does not retry an entire document after a rate-limited or uncertain PUT', async () => {
    vi.mocked(overwriteTopicObsidianNote).mockRejectedValue(
      new Error('HTTP 429'),
    );
    expect((await reExportObsidianNotes(request())).failed).toBe(1);
    expect(overwriteTopicObsidianNote).toHaveBeenCalledTimes(1);
    expect(buildTopicExport).toHaveBeenCalledTimes(1);
  });

  it('snapshots the entire batch before a suspended build can observe UI mutation', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(buildTopicExport).mockImplementationOnce(async () => {
      await pending;
      return document();
    });
    const input = request([
      item({ path: 'one.md' }),
      item({
        path: 'two.md',
        exportProfile: buildExportProfile(DEFAULTS, filters),
      }),
    ]);
    const batch = reExportObsidianNotes(input);
    input.items[1].path = 'changed.md';
    input.items[1].exportProfile!.filters.users.push('Mallory');
    input.config.obsApiKey = 'changed';
    input.apiConfig.apiKey = 'changed';
    input.origin = 'https://other.example';
    release();
    await batch;
    expect(buildTopicExport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        origin: 'https://example.com',
        filters,
        config: expect.objectContaining({ obsApiKey: '' }),
      }),
    );
    expect(overwriteTopicObsidianNote).toHaveBeenNthCalledWith(
      2,
      document(),
      expect.any(Object),
      connection,
      'two.md',
      undefined,
      undefined,
    );
  });

  it('keeps completed counts and stops new work after cancellation', async () => {
    const controller = new AbortController();
    vi.mocked(overwriteTopicObsidianNote).mockImplementationOnce(async () => {
      controller.abort();
      return { updated: true };
    });
    const input = request([item({ path: 'one.md' }), item({ path: 'two.md' })]);
    input.signal = controller.signal;
    expect(await reExportObsidianNotes(input)).toMatchObject({
      success: 1,
      updated: 1,
      failed: 0,
      cancelled: true,
    });
    expect(buildTopicExport).toHaveBeenCalledTimes(1);
  });

  it('does not count a cancelled read or wait as a failed write', async () => {
    const controller = new AbortController();
    vi.mocked(buildTopicExport).mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
    const input = { ...request(), signal: controller.signal };
    expect(await reExportObsidianNotes(input)).toMatchObject({
      success: 0,
      failed: 0,
      cancelled: true,
      results: [],
    });
    expect(overwriteTopicObsidianNote).not.toHaveBeenCalled();
  });

  it('recognizes an explicit abort reason without counting an untouched note as failed', async () => {
    const controller = new AbortController();
    vi.mocked(buildTopicExport).mockImplementationOnce(async () => {
      controller.abort('User cancelled');
      throw controller.signal.reason;
    });
    expect(
      await reExportObsidianNotes({ ...request(), signal: controller.signal }),
    ).toMatchObject({
      success: 0,
      failed: 0,
      cancelled: true,
      results: [],
    });
  });
});
