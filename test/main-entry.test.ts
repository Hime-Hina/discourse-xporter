// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelCallbacks } from '../src/ui/panel';
import type { TopicLifecycleCallbacks } from '../src/runtime/topic-lifecycle';
import type { TopicExportResult } from '../src/core/topic-export';

const boundary = vi.hoisted(() => ({
  panel: vi.fn<(callbacks: PanelCallbacks) => void>(),
  lifecycle: vi.fn<(callbacks: TopicLifecycleCallbacks) => void>(),
  build: vi.fn<typeof import('../src/core/topic-export').buildTopicExport>(),
  write:
    vi.fn<
      typeof import('../src/export/topic-delivery').writeTopicToConfiguredObsidian
    >(),
  batch:
    vi.fn<
      typeof import('../src/export/obsidian-batch').reExportObsidianNotes
    >(),
  outdated:
    vi.fn<
      typeof import('../src/export/obsidian-api').searchOutdatedByTopicId
    >(),
  toast: vi.fn<typeof import('../src/ui/toast').showToast>(),
  lock: vi.fn(),
  download: vi.fn(),
}));
vi.mock('../src/core/topic-export', () => ({
  buildTopicExport: boundary.build,
}));
vi.mock('../src/export/topic-delivery', () => ({
  writeTopicToConfiguredObsidian: boundary.write,
  downloadTopicMarkdown: boundary.download,
  downloadTopicZip: vi.fn(),
  refreshObsidianNoteLinks: vi.fn(),
}));
vi.mock('../src/export/obsidian-batch', () => ({
  reExportObsidianNotes: boundary.batch,
  scanExportedNotesByOrigin: vi.fn(),
}));
vi.mock('../src/export/obsidian-api', () => ({
  searchOutdatedByTopicId: boundary.outdated,
  testConnection: vi.fn(),
}));
vi.mock('../src/ui/toast', () => ({ showToast: boundary.toast }));
vi.mock('../src/ui/panel', () => ({
  initPanel: boundary.panel,
  refreshCredentialStatus: vi.fn(),
  refreshPathPreview: vi.fn(),
  setExportLock: boundary.lock,
  resetProgress: vi.fn(),
  updateProgress: vi.fn(),
  togglePanel: vi.fn(),
  getPanelFilterConfig: () => ({
    rangeMode: 'all',
    rangeStart: 1,
    rangeEnd: Infinity,
    onlyOp: false,
    imgFilter: 'none',
    users: [],
    includeKeywords: [],
    excludeKeywords: [],
    minLength: 0,
  }),
}));
vi.mock('../src/ui/floor-buttons', () => ({
  initFloorButtons: () => vi.fn(),
  setOnCopyPost: vi.fn(),
  clearSelectedPosts: vi.fn(),
  getSelectedPosts: () => new Set([2]),
  getSelectedPostIds: () => new Map([[2, 210]]),
}));
vi.mock('../src/runtime/topic-lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/runtime/topic-lifecycle')>()),
  startTopicLifecycle: boundary.lifecycle,
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
const documentResult: TopicExportResult = {
  origin: 'http://localhost:3000',
  topicId: 100,
  safeTitle: 'Fixture',
  markdown: 'fixture',
};

beforeEach(async () => {
  vi.stubEnv('DEV', false);
  vi.resetModules();
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('GM_getValue', () => ({ obsApiKey: 'SYNTHETIC_KEY' }));
  vi.stubGlobal('GM_setValue', vi.fn());
  vi.stubGlobal('GM_registerMenuCommand', vi.fn());
  vi.stubGlobal('GM_addStyle', vi.fn());
  document.head.innerHTML = '<meta name="generator" content="Discourse">';
  window.history.replaceState({}, '', '/t/fixture/100');
  boundary.build.mockResolvedValue(documentResult);
  boundary.write.mockResolvedValue({ updated: true });
  boundary.outdated.mockResolvedValue(false);
  await import('../src/main');
  boundary.lifecycle.mock.calls[0][0].activateTopic({
    topicId: 100,
    isNested: false,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  document.head.innerHTML = '';
});

function panelCallbacks(): PanelCallbacks {
  return boundary.panel.mock.calls[0][0];
}

describe('entry point operation contracts', () => {
  it('rejects batch writes while an export owns the shared gate and snapshots the origin', async () => {
    const pending = deferred<TopicExportResult>();
    boundary.build.mockReturnValue(pending.promise);
    const started = panelCallbacks().onDownloadMd();
    expect(boundary.build.mock.calls[0][0].selectedPostIds?.get(2)).toBe(210);
    const sourceOrigin = window.location.origin;
    window.history.replaceState({}, '', '/t/next/200');
    const { doBatchReExport } = await import('../src/main');
    await expect(doBatchReExport([], vi.fn())).rejects.toThrow('已有导出任务');
    expect(boundary.batch).not.toHaveBeenCalled();
    pending.resolve(documentResult);
    await started;
    expect(boundary.build.mock.calls[0][0].origin).toBe(sourceOrigin);
    expect(boundary.lock.mock.calls).toEqual([[true], [false]]);
  });

  it('does not show or execute an outdated action after navigating to another topic', async () => {
    const pending = deferred<boolean>();
    boundary.outdated.mockReturnValue(pending.promise);
    const checking =
      boundary.lifecycle.mock.calls[0][0].checkOutdatedTopic(100);
    window.history.replaceState({}, '', '/t/other/200');
    pending.resolve(true);
    await checking;
    expect(boundary.toast).not.toHaveBeenCalled();
    window.history.replaceState({}, '', '/t/fixture/100');
    boundary.outdated.mockResolvedValue(true);
    await boundary.lifecycle.mock.calls[0][0].checkOutdatedTopic(100);
    const action = boundary.toast.mock.calls[0][3];
    expect(action?.label).toBe('重新导出');
    window.history.replaceState({}, '', '/t/other/200');
    action?.onClick();
    expect(boundary.build).not.toHaveBeenCalled();
    expect(boundary.outdated.mock.calls[0][3]).toBe(window.location.origin);
  });

  it('propagates cancellation and releases ownership after the in-flight build settles', async () => {
    boundary.build.mockImplementation(
      (options) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener(
            'abort',
            () => reject(options.signal?.reason),
            { once: true },
          );
        }),
    );
    const exporting = panelCallbacks().onDownloadMd();
    panelCallbacks().onCancelExport?.();
    await exporting;
    expect(boundary.build.mock.calls[0][0].signal?.aborted).toBe(true);
    expect(boundary.download).not.toHaveBeenCalled();
    expect(boundary.toast).toHaveBeenCalledWith('导出已取消', 'info');
    expect(boundary.lock.mock.calls).toEqual([[true], [false]]);
  });

  it('reports a successful write separately from a failed open operation', async () => {
    boundary.write.mockResolvedValue({
      updated: true,
      openFailed: 'fixture open failed',
    });
    await panelCallbacks().onExportObsidian();
    expect(boundary.toast.mock.calls[0][0]).toContain(
      '笔记已导出；打开 Obsidian 失败',
    );
    expect(boundary.toast.mock.calls[0][1]).toBe('info');
    expect(
      boundary.toast.mock.calls.some((call) => call[0].startsWith('导出失败')),
    ).toBe(false);
  });
});
