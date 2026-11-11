// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureUserClicks } from './trusted-click';
import type { BatchItem } from '../src/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
function button(label: string): HTMLButtonElement {
  const element = Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.includes(label),
  );
  if (!element) throw new Error(`Missing button: ${label}`);
  return element;
}
const oldNote: BatchItem = {
  path: 'fixture.md',
  title: 'Fixture',
  topicId: 42,
  xporterVersion: 1,
  source: 'https://forum.example/t/topic/42',
};

beforeEach(() => {
  vi.stubEnv('DEV', false);
  vi.resetModules();
  document.body.innerHTML = '';
  vi.stubGlobal('GM_getValue', () => ({ obsApiKey: 'SYNTHETIC_KEY' }));
  vi.stubGlobal('GM_setValue', vi.fn());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  document.body.innerHTML = '';
});

describe('batch UI completion handoff', () => {
  it('awaits the automatic refresh and updates labels and selection after writing', async () => {
    const userClick = captureUserClicks();
    const refresh = deferred<BatchItem[]>();
    const scan = vi
      .fn()
      .mockResolvedValueOnce([oldNote])
      .mockReturnValueOnce(refresh.promise);
    const write = vi.fn().mockResolvedValue({
      success: 1,
      failed: 0,
      updated: 1,
      unchanged: 0,
      cancelled: false,
      failures: [],
      results: [{ path: oldNote.path, status: 'updated' }],
    });
    const { initPanel } = await import('../src/ui/panel');
    initPanel({
      onExportObsidian: vi.fn(),
      onDownloadZip: vi.fn(),
      onDownloadMd: vi.fn(),
      onTestConnection: vi.fn(),
      onBatchScan: scan,
      onBatchReExport: write,
      formatVersion: 2,
    });
    await userClick(button('扫描笔记'));
    expect(document.body.textContent).toContain('v1 → v2');
    const pending = userClick(button('开始重导'));
    await Promise.resolve();
    await Promise.resolve();
    expect(scan).toHaveBeenCalledTimes(2);
    expect(button('扫描中').disabled).toBe(true);
    expect(button('开始重导').disabled).toBe(true);
    refresh.resolve([{ ...oldNote, xporterVersion: 2 }]);
    await pending;
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain('v2  ✅'),
    );
    expect(
      document.querySelector<HTMLInputElement>('.dxp-batch-row input')?.checked,
    ).toBe(false);
    expect(button('扫描笔记').disabled).toBe(false);
  });

  it('reports refresh failure separately and permits a manual rescan', async () => {
    const userClick = captureUserClicks();
    const scan = vi
      .fn()
      .mockResolvedValueOnce([oldNote])
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce([{ ...oldNote, xporterVersion: 2 }]);
    const { initPanel } = await import('../src/ui/panel');
    initPanel({
      onExportObsidian: vi.fn(),
      onDownloadZip: vi.fn(),
      onDownloadMd: vi.fn(),
      onTestConnection: vi.fn(),
      onBatchScan: scan,
      onBatchReExport: vi.fn().mockResolvedValue({
        success: 1,
        failed: 0,
        updated: 1,
        unchanged: 0,
        cancelled: false,
        failures: [],
        results: [{ path: oldNote.path, status: 'updated' }],
      }),
      formatVersion: 2,
    });
    await userClick(button('扫描笔记'));
    await userClick(button('开始重导'));
    await vi.waitFor(() =>
      expect(document.querySelector('.dxp-toast')?.textContent).toContain(
        '1 更新，0 未变化，0 失败；状态刷新失败',
      ),
    );
    expect(button('扫描笔记').disabled).toBe(false);
    await userClick(button('扫描笔记'));
    expect(scan).toHaveBeenCalledTimes(3);
  });

  it('keeps failed records distinct by path and ignores synthetic privileged clicks', async () => {
    const userClick = captureUserClicks();
    const another = { ...oldNote, path: 'another.md' };
    const scan = vi.fn().mockResolvedValue([oldNote, another]);
    const write = vi.fn().mockResolvedValue({
      success: 1,
      failed: 1,
      updated: 1,
      unchanged: 0,
      cancelled: false,
      results: [
        { path: oldNote.path, status: 'updated' },
        { path: another.path, status: 'failed' },
      ],
      failures: [
        {
          path: another.path,
          title: another.title,
          message: 'fixture failure',
        },
      ],
    });
    const { initPanel } = await import('../src/ui/panel');
    initPanel({
      onExportObsidian: vi.fn(),
      onDownloadZip: vi.fn(),
      onDownloadMd: vi.fn(),
      onTestConnection: vi.fn(),
      onBatchScan: scan,
      onBatchReExport: write,
      formatVersion: 2,
    });
    button('扫描笔记').click();
    expect(scan).not.toHaveBeenCalled();
    await userClick(button('扫描笔记'));
    await userClick(button('开始重导'));
    await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(2));
    const boxes = Array.from(
      document.querySelectorAll<HTMLInputElement>('.dxp-batch-row input'),
    );
    expect(boxes.map((box) => box.checked)).toEqual([false, true]);
    await userClick(button('开始重导'));
    expect(write.mock.calls[1][0]).toEqual([another]);
  });

  it('requires a user action for selected-note link refresh and awaits the resulting rescan', async () => {
    const userClick = captureUserClicks();
    const scan = vi.fn().mockResolvedValue([oldNote]);
    const refreshLinks = vi
      .fn()
      .mockResolvedValue({ updated: 1, ambiguous: 0 });
    const { initPanel } = await import('../src/ui/panel');
    initPanel({
      onExportObsidian: vi.fn(),
      onDownloadZip: vi.fn(),
      onDownloadMd: vi.fn(),
      onTestConnection: vi.fn(),
      onBatchScan: scan,
      onBatchReExport: vi.fn(),
      onBatchRefreshLinks: refreshLinks,
      formatVersion: 2,
    });
    await userClick(button('扫描笔记'));
    button('更新所选笔记链接').click();
    expect(refreshLinks).not.toHaveBeenCalled();
    await userClick(button('更新所选笔记链接'));
    await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(2));
    expect(refreshLinks).toHaveBeenCalledWith([oldNote]);
    expect(document.querySelector('.dxp-toast')?.textContent).toContain(
      '链接更新完成：1 篇更新',
    );
    expect(button('扫描笔记').disabled).toBe(false);
  });

  it('preserves unstarted selections on cancellation and passes only an explicit replacement choice', async () => {
    const userClick = captureUserClicks();
    const unstarted = { ...oldNote, path: 'unstarted.md' };
    const scan = vi.fn().mockResolvedValue([oldNote, unstarted]);
    const write = vi
      .fn()
      .mockResolvedValue({
        success: 1,
        updated: 1,
        unchanged: 0,
        failed: 0,
        cancelled: true,
        failures: [],
        results: [{ path: oldNote.path, status: 'updated' }],
      });
    const { initPanel } = await import('../src/ui/panel');
    initPanel({
      onExportObsidian: vi.fn(),
      onDownloadZip: vi.fn(),
      onDownloadMd: vi.fn(),
      onTestConnection: vi.fn(),
      onBatchScan: scan,
      onBatchReExport: write,
      formatVersion: 2,
    });
    await userClick(button('扫描笔记'));
    expect(document.body.textContent).toContain('缺少可恢复策略');
    const replacement = document.querySelector<HTMLInputElement>(
      '.dxp-batch-profile-override',
    );
    if (!replacement) throw new Error('Missing replacement checkbox');
    replacement.checked = true;
    await userClick(button('开始重导'));
    await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(2));
    expect(write.mock.calls[0][2]).toBe(true);
    expect(
      Array.from(
        document.querySelectorAll<HTMLInputElement>('.dxp-batch-row input'),
      ).map((box) => box.checked),
    ).toEqual([false, true]);
    expect(document.querySelector('.dxp-toast')?.textContent).toContain(
      '批量重导已取消',
    );
  });
});
