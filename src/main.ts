import type { BatchItem } from './types';
import { FORMAT_VERSION } from './config/format-version';
import { getConfig } from './config/storage';
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

// ==================== Export Logic ====================

async function doExport(mode: 'obsidian' | 'zip' | 'md'): Promise<void> {
  const topicIdentity = detectTopicIdentity();
  if (!topicIdentity) {
    showToast('未检测到话题页面', 'error');
    return;
  }

  const config = getConfig();
  const filters = getPanelFilterConfig();

  setExportLock(true);
  try {
    debugLog('Starting export, mode:', mode, 'topicId:', topicIdentity.topicId);
    const selectedPosts = getSelectedPosts();
    const exportData = await buildTopicExport({
      topicId: topicIdentity.topicId,
      origin: window.location.origin,
      forumName: getForumName(),
      formatVersion: FORMAT_VERSION,
      config,
      filters,
      selectedPosts,
      onProgress: updateProgress,
    });

    if (mode === 'md') {
      downloadTopicMarkdown(exportData);
      showToast('Markdown 下载完成 ✓');
    } else if (mode === 'zip') {
      const delivery = await downloadTopicZip(
        exportData,
        config,
        updateProgress,
      );
      showToast(
        delivery.downloadedFileKind === 'markdown'
          ? '无图片，已下载纯 Markdown ✓'
          : 'ZIP 下载完成 ✓',
      );
    } else if (mode === 'obsidian') {
      await writeTopicToConfiguredObsidian(exportData, config, updateProgress);
      showToast('已导出到 Obsidian ✓');
    }
  } catch (err) {
    console.error('[Discourse Xporter]', err);
    showToast(
      `导出失败: ${err instanceof Error ? err.message : String(err)}`,
      'error',
      5000,
    );
  } finally {
    setExportLock(false);
    resetProgress();
  }
}

// ==================== Single Post Copy ====================

async function handleCopyPost(
  postNumber: number,
  postId: number,
): Promise<void> {
  const topicIdentity = detectTopicIdentity();
  if (!topicIdentity) return;

  const config = getConfig();
  const origin = window.location.origin;

  try {
    const content = await buildSinglePostMarkdown({
      topicId: topicIdentity.topicId,
      postNumber,
      postId,
      origin,
      config,
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
    );
    if (outdated) {
      showToast('该话题的笔记格式已过期，建议重新导出', 'info', 8000, {
        label: '重新导出',
        onClick: () => void doExport('obsidian'),
      });
    }
  } catch {
    // Silent ignore — don't block page
  }
}

let panelMenuRegistered = false;
let topicUiInitialized = false;

function registerPanelMenuCommand(): void {
  if (panelMenuRegistered) return;
  GM_registerMenuCommand('⚙️ Discourse Xporter', togglePanel);
  panelMenuRegistered = true;
}

function activateTopicUi(topicIdentity: TopicIdentity): void {
  debugLog(
    `Topic ${topicIdentity.topicId} (${topicIdentity.isNested ? 'nested' : 'flat'} view)`,
  );

  if (topicUiInitialized) return;

  setOnCopyPost(handleCopyPost);
  initFloorButtons();
  initPanel({
    onExportObsidian: () => doExport('obsidian'),
    onDownloadZip: () => doExport('zip'),
    onDownloadMd: () => doExport('md'),
    onTestConnection: (apiUrl, apiKey) => testConnection({ apiUrl, apiKey }),
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
): Promise<{ success: number; failed: number }> {
  const config = getConfig();
  const apiCfg: ObsidianApiConfig = {
    apiUrl: config.obsApiUrl,
    apiKey: config.obsApiKey,
  };
  return reExportObsidianNotes({
    items,
    config,
    apiConfig: apiCfg,
    origin: window.location.origin,
    forumName: getForumName(),
    formatVersion: FORMAT_VERSION,
    onProgress,
  });
}

function init(): void {
  if (!isDiscourse()) return;

  console.log('[Discourse Xporter] Discourse detected, initializing…');

  injectStyles();
  registerPanelMenuCommand();

  startTopicLifecycle({
    activateTopic: activateTopicUi,
    resetTopicState: clearSelectedPosts,
    checkOutdatedTopic: checkOutdatedNote,
    togglePanel,
  });
}

init();
