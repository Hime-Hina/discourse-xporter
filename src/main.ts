import type { BatchItem } from './types';
import { buildExportProfile } from './core/export-profile';
import type { ObsidianBatchReExportSummary } from './export/obsidian-batch';
import { createExportOperation } from './runtime/export-operation';
import { FORMAT_VERSION } from './config/format-version';
import { getConfig } from './config/storage';
import { registerCredentialMenu } from './config/credentials';
import { topicPaths } from './export/paths';
import { buildTopicExport } from './core/topic-export';
import { buildSinglePostMarkdown } from './core/single-post-export';
import { copyToClipboard } from './export/clipboard';
import { testConnection, searchOutdatedByTopicId } from './export/obsidian-api';
import type { ObsidianApiConfig } from './export/obsidian-api';
import {
  reExportObsidianNotes,
  scanExportedNotesByOrigin,
} from './export/obsidian-batch';
import {
  downloadTopicMarkdown,
  downloadTopicZip,
  writeTopicToConfiguredObsidian,
  refreshObsidianNoteLinks,
} from './export/topic-delivery';
import { injectStyles } from './ui/styles';
import { showToast } from './ui/toast';
import {
  detectTopicIdentity,
  startTopicLifecycle,
  type TopicIdentity,
} from './runtime/topic-lifecycle';
import {
  initPanel,
  refreshCredentialStatus,
  refreshPathPreview,
  updateProgress,
  resetProgress,
  getPanelFilterConfig,
  togglePanel,
  setExportLock,
} from './ui/panel';
import {
  initFloorButtons,
  setOnCopyPost,
  getSelectedPosts,
  getSelectedPostIds,
  clearSelectedPosts,
} from './ui/floor-buttons';

export { FORMAT_VERSION };

declare function GM_registerMenuCommand(
  caption: string,
  onClick: () => void,
): void;

// ==================== Debug Logging ====================

function debugLog(...args: unknown[]): void {
  const cfg = getConfig();
  if (cfg.debugMode) {
    console.log('[DXP]', ...args);
  }
}

// ==================== Discourse Detection ====================

function isDiscourse(): boolean {
  return !!(
    document.querySelector('meta[name="generator"][content*="Discourse"]') ||
    (window as unknown as Record<string, unknown>).Discourse
  );
}

/** Extract forum display name from the page */
function getForumName(): string {
  // Try og:site_name meta tag first
  const ogSiteName = document.querySelector('meta[property="og:site_name"]');
  if (ogSiteName?.getAttribute('content')) {
    return ogSiteName.getAttribute('content')!.trim();
  }
  // Fallback to the Discourse site heading / logo text
  const logoText =
    document.querySelector('#site-text-logo')?.textContent ??
    document.querySelector('.header-title .logo-text')?.textContent;
  if (logoText?.trim()) return logoText.trim();
  // Last resort: hostname
  return location.hostname;
}

const exportOperation = createExportOperation((busy) => {
  setExportLock(busy);
  if (!busy) resetProgress();
});

// ==================== Export Logic ====================

async function doExport(mode: 'obsidian' | 'zip' | 'md'): Promise<void> {
  const topicIdentity = detectTopicIdentity();
  if (!topicIdentity) {
    showToast('未检测到话题页面', 'error');
    return;
  }

  const config = getConfig();
  const filters = getPanelFilterConfig();

  const origin = window.location.origin;
  const forumName = getForumName();
  const selectedPosts = getSelectedPosts();
  const selectedPostIds = getSelectedPostIds();

  try {
    await exportOperation.run(async (signal) => {
      debugLog(
        'Starting export, mode:',
        mode,
        'topicId:',
        topicIdentity.topicId,
      );
      const exportOptions = {
        topicId: topicIdentity.topicId,
        origin,
        forumName,
        formatVersion: FORMAT_VERSION,
        config,
        filters,
        selectedPosts,
        selectedPostIds,
        signal,
        onProgress: updateProgress,
      };
      const exportData = await buildTopicExport(exportOptions);

      signal.throwIfAborted();
      if (mode === 'md') {
        downloadTopicMarkdown(exportData);
        showToast('Markdown 下载完成 ✓');
      } else if (mode === 'zip') {
        const delivery = await downloadTopicZip(
          exportData,
          config,
          updateProgress,
          signal,
        );
        showToast(
          delivery.downloadedFileKind === 'markdown'
            ? '无图片，已下载纯 Markdown ✓'
            : 'ZIP 下载完成 ✓',
        );
      } else if (mode === 'obsidian') {
        const delivery = await writeTopicToConfiguredObsidian(
          exportData,
          config,
          updateProgress,
          signal,
        );
        if (delivery.openFailed) {
          showToast(
            `笔记已${delivery.updated ? '导出' : '确认未变化'}；打开 Obsidian 失败：${delivery.openFailed}`,
            'info',
            5000,
          );
        } else {
          showToast(
            delivery.updated
              ? '已导出到 Obsidian ✓'
              : '笔记未变化，已跳过写入 ✓',
          );
        }
      }
    });
  } catch (err) {
    if (
      (err instanceof DOMException || err instanceof Error) &&
      err.name === 'AbortError'
    ) {
      showToast('导出已取消', 'info');
      return;
    }
    console.error('[Discourse Xporter]', err);
    showToast(
      `导出失败: ${err instanceof Error ? err.message : String(err)}`,
      'error',
      5000,
    );
  }
}

// ==================== Single Post Copy ====================

async function handleCopyPost(
  postNumber: number,
  postId: number,
): Promise<void> {
  const topicIdentity = detectTopicIdentity();
  if (!topicIdentity) return;

  const origin = window.location.origin;

  try {
    const content = await buildSinglePostMarkdown({
      topicId: topicIdentity.topicId,
      postNumber,
      postId,
      origin,
    });
    copyToClipboard(content);
    showToast(`已复制 #${postNumber} 的 Markdown ✓`);
  } catch (err) {
    console.error('[DXP] Copy failed:', err);
    showToast('复制失败', 'error');
  }
}

// ==================== Init ====================

// ==================== Outdated Note Check ====================

async function checkOutdatedNote(topicId: number): Promise<void> {
  const config = getConfig();
  const origin = window.location.origin;
  if (!config.obsApiKey) return;

  const apiCfg: ObsidianApiConfig = {
    apiUrl: config.obsApiUrl,
    apiKey: config.obsApiKey,
  };

  try {
    const outdated = await searchOutdatedByTopicId(
      apiCfg,
      topicId,
      FORMAT_VERSION,
      origin,
    );
    if (
      outdated &&
      window.location.origin === origin &&
      detectTopicIdentity()?.topicId === topicId
    ) {
      showToast('该话题的笔记格式已过期，建议重新导出', 'info', 8000, {
        label: '重新导出',
        onClick: () => {
          if (
            window.location.origin === origin &&
            detectTopicIdentity()?.topicId === topicId
          )
            void doExport('obsidian');
        },
      });
    }
  } catch {
    // Silent ignore — don't block page
  }
}

let panelMenuRegistered = false;
let topicUiInitialized = false;
let stopFloorButtons: (() => void) | null = null;

function registerPanelMenuCommand(): void {
  if (panelMenuRegistered) return;
  GM_registerMenuCommand('⚙️ Discourse Xporter', togglePanel);
  registerCredentialMenu(refreshCredentialStatus);
  panelMenuRegistered = true;
}

function activateTopicUi(topicIdentity: TopicIdentity): void {
  debugLog(
    `Topic ${topicIdentity.topicId} (${topicIdentity.isNested ? 'nested' : 'flat'} view)`,
  );

  stopFloorButtons?.();
  stopFloorButtons = initFloorButtons();
  if (topicUiInitialized) {
    refreshPathPreview();
    return;
  }

  setOnCopyPost(handleCopyPost);
  initPanel({
    onCancelExport: () => exportOperation.cancel(),
    onBatchRefreshLinks: refreshSelectedNoteLinks,
    onExportObsidian: () => doExport('obsidian'),
    onDownloadZip: () => doExport('zip'),
    onDownloadMd: () => doExport('md'),
    onTestConnection: (apiUrl) =>
      testConnection({ apiUrl, apiKey: getConfig().obsApiKey }),
    onImagePathPreview: (settings) => {
      const identity = detectTopicIdentity();
      return identity
        ? topicPaths(settings, window.location.origin, identity.topicId, '')
            .imageDir
        : '请先打开话题';
    },
    onBatchScan: scanExportedNotes,
    onBatchReExport: doBatchReExport,
    formatVersion: FORMAT_VERSION,
  });
  topicUiInitialized = true;
}

// ==================== Batch Re-export ====================

export async function scanExportedNotes(): Promise<BatchItem[]> {
  const config = getConfig();
  const apiCfg: ObsidianApiConfig = {
    apiUrl: config.obsApiUrl,
    apiKey: config.obsApiKey,
  };
  return scanExportedNotesByOrigin(apiCfg, window.location.origin);
}

export async function doBatchReExport(
  items: BatchItem[],
  onProgress: (current: number, total: number, title: string) => void,
  replaceSavedSettings = false,
): Promise<ObsidianBatchReExportSummary> {
  const config = getConfig();
  const apiCfg: ObsidianApiConfig = {
    apiUrl: config.obsApiUrl,
    apiKey: config.obsApiKey,
  };
  const origin = window.location.origin;
  const forumName = getForumName();
  const selectedItems = items.map((item) => ({ ...item }));
  const filters = replaceSavedSettings ? getPanelFilterConfig() : undefined;
  if (filters?.rangeMode === 'selected') {
    throw new Error(
      '批量替换策略不能复用当前话题的手动楼层选择，请选择全部楼层或楼层范围',
    );
  }
  const profileOverride = replaceSavedSettings
    ? buildExportProfile(config, filters)
    : undefined;
  return exportOperation.run((signal) =>
    reExportObsidianNotes({
      items: selectedItems,
      profileOverride,
      signal,
      config,
      apiConfig: apiCfg,
      origin,
      forumName,
      formatVersion: FORMAT_VERSION,
      onProgress,
    }),
  );
}

async function refreshSelectedNoteLinks(
  items: BatchItem[],
): Promise<{ updated: number; ambiguous: number }> {
  const config = getConfig();
  const apiConfig = { apiUrl: config.obsApiUrl, apiKey: config.obsApiKey };
  const origin = window.location.origin;
  const selectedItems = items.map((item) => ({ ...item }));
  return exportOperation.run((signal) =>
    refreshObsidianNoteLinks(apiConfig, origin, selectedItems, signal),
  );
}

function init(): void {
  if (!isDiscourse()) return;

  console.log('[Discourse Xporter] Discourse detected, initializing…');

  injectStyles();
  registerPanelMenuCommand();

  startTopicLifecycle({
    activateTopic: activateTopicUi,
    resetTopicState: () => {
      stopFloorButtons?.();
      stopFloorButtons = null;
      clearSelectedPosts();
    },
    checkOutdatedTopic: checkOutdatedNote,
    togglePanel,
  });
}

init();
