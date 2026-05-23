import type {
  Config,
  DiscourseTopic,
  BatchItem,
  PipelineContext,
} from './types';
import { getConfig } from './config/storage';
import { resolveUploadUrls } from './core/api';
import { buildTopicExport } from './core/topic-export';
import { processRaw } from './core/raw-pipeline';
import { cookedToMarkdown } from './core/cooked-fallback';
import { copyToClipboard } from './export/clipboard';
import { downloadFile } from './export/download';
import {
  testConnection,
  searchOutdatedByTopicId,
  searchByOrigin,
  getNoteMetadata,
  writeNote,
  openNote,
} from './export/obsidian-api';
import type { ObsidianApiConfig } from './export/obsidian-api';
import {
  buildImageZip,
  collectImageAssets,
  downloadImageAssets,
  downloadZipBytes,
  joinVaultPath,
  resolveImgDir,
  rewriteImageUrlsForObsidian,
  rewriteImageUrlsForZip,
  stripImages,
  uploadImageAssets,
} from './export/image-assets';
import { injectStyles } from './ui/styles';
import { showToast } from './ui/toast';
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
} from './ui/floor-buttons';
import { sleepRandom } from './utils/timing';

/** Format version — increment only on incompatible output format changes */
export const FORMAT_VERSION = 1;

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

function getTopicInfo(): { topicId: number; isNested: boolean } | null {
  const match = location.pathname.match(/^\/(t|nested)\/[^/]+\/(\d+)/);
  if (!match) return null;
  return {
    isNested: match[1] === 'nested',
    topicId: parseInt(match[2], 10),
  };
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
    document.querySelector('#site-text-logo')?.textContent??
    document.querySelector('.header-title .logo-text')?.textContent;
  if (logoText?.trim()) return logoText.trim();
  // Last resort: hostname
  return location.hostname;
}

// ==================== Export Logic ====================

async function doExport(mode: 'obsidian' | 'zip' | 'md'): Promise<void> {
  const info = getTopicInfo();
  if (!info) {
    showToast('未检测到话题页面', 'error');
    return;
  }

  const config = getConfig();
  const filters = getPanelFilterConfig();

  setExportLock(true);
  try {
    debugLog('Starting export, mode:', mode, 'topicId:', info.topicId);
    const selectedPosts = getSelectedPosts();
    const exportData = await buildTopicExport({
      topicId: info.topicId,
      origin: window.location.origin,
      forumName: getForumName(),
      formatVersion: FORMAT_VERSION,
      config,
      filters,
      selectedPosts,
      onProgress: updateProgress,
    });

    if (mode === 'md') {
      downloadFile(
        exportData.markdown,
        `${exportData.safeTitle}.md`,
        'text/markdown;charset=utf-8',
      );
      showToast('Markdown 下载完成 ✓');
    } else if (mode === 'zip') {
      await exportAsZip(
        exportData.markdown,
        exportData.safeTitle,
        exportData.topicId,
        config,
      );
    } else if (mode === 'obsidian') {
      await exportToObsidian(
        exportData.markdown,
        exportData.safeTitle,
        exportData.topicId,
        config,
      );
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

async function exportAsZip(
  markdown: string,
  safeTitle: string,
  topicId: number,
  config: Config,
): Promise<void> {
  const imageAssets = collectImageAssets(markdown);

  if (imageAssets.size === 0) {
    downloadFile(markdown, `${safeTitle}.md`, 'text/markdown;charset=utf-8');
    showToast('无图片，已下载纯 Markdown ✓');
    return;
  }

  const effectiveImgDir = resolveImgDir(config);
  const md = rewriteImageUrlsForZip(
    markdown,
    imageAssets,
    effectiveImgDir,
    topicId,
  );
  const images = await downloadImageAssets(imageAssets, config, updateProgress);

  updateProgress('打包 ZIP…', 1);
  const zipBytes = buildImageZip(
    md,
    safeTitle,
    topicId,
    config,
    images,
  );
  downloadZipBytes(zipBytes, safeTitle);
  showToast('ZIP 下载完成 ✓');
}

async function exportToObsidian(
  markdown: string,
  safeTitle: string,
  topicId: number,
  config: Config,
): Promise<void> {
  const apiCfg = { apiUrl: config.obsApiUrl, apiKey: config.obsApiKey };

  if (!config.obsApiKey) {
    showToast('请先配置 Obsidian API Key', 'error');
    return;
  }

  // Test connection
  updateProgress('连接 Obsidian…', 0.1);
  const connected = await testConnection(apiCfg);
  if (!connected) {
    showToast('无法连接 Obsidian Local REST API', 'error', 5000);
    return;
  }

  const notePath = joinVaultPath(config.exportDir, `${safeTitle}.md`);
  let md = markdown;
  const effectiveImgDir = resolveImgDir(config);

  if (config.imgMode === 'file') {
    const imageAssets = collectImageAssets(md);
    debugLog(`[Obsidian] Found ${imageAssets.size} images to upload`);

    await uploadImageAssets(
      imageAssets,
      apiCfg,
      config,
      effectiveImgDir,
      topicId,
      updateProgress,
    );
    md = rewriteImageUrlsForObsidian(md, imageAssets, effectiveImgDir, topicId);
  } else if (config.imgMode === 'none') {
    md = stripImages(md);
  }
  // imgMode === 'embed': keep standard markdown image links as-is

  // Write note
  updateProgress('写入笔记…', 0.9);
  await writeNote(apiCfg, notePath, md);

  // Open note in Obsidian
  if (config.obsOpenAfterExport) {
    await openNote(apiCfg, notePath);
  }

  showToast('已导出到 Obsidian ✓');
}

// ==================== Single Post Copy ====================

async function handleCopyPost(
  postNumber: number,
  _postId: number,
): Promise<void> {
  const info = getTopicInfo();
  if (!info) return;

  const config = getConfig();
  const origin = window.location.origin;

  try {
    // Fetch just this post's data — try from already loaded DOM first
    // We'll fetch the topic to get the post data
    const res = await fetch(`/t/topic/${info.topicId}.json?include_raw=true`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const topic: DiscourseTopic = await res.json();

    let post = topic.post_stream.posts.find(
      (p) => p.post_number === postNumber,
    );

    if (!post) {
      // Fetch individual post by number
      const postsRes = await fetch(
        `/t/${info.topicId}/posts.json?post_ids[]=${_postId}&include_raw=true`,
      );
      if (postsRes.ok) {
        const data = await postsRes.json();
        post = data?.post_stream?.posts?.[0];
      }
    }

    if (!post) {
      showToast('无法获取帖子数据', 'error');
      return;
    }

    // Resolve uploads
    const uploadUrls = post.raw?.match(/upload:\/\/[a-zA-Z0-9._-]+/g) ?? [];
    const uploadMap = await resolveUploadUrls(uploadUrls);

    const ctx: PipelineContext = {
      origin,
      topicId: info.topicId,
      topicSlug: topic.slug,
      polls: post.polls ?? [],
      cookedHtml: post.cooked,
      config,
      uploadMap,
    };

    let content: string;
    if (post.raw) {
      content = processRaw(post.raw, ctx);
    } else {
      content = cookedToMarkdown(post.cooked);
    }

    copyToClipboard(content);
    showToast(`已复制 #${postNumber} 的 Markdown ✓`);
  } catch (err) {
    console.error('[DXP] Copy failed:', err);
    showToast('复制失败', 'error');
  }
}

// ==================== Init ====================

/** Inject export toggle button into the topic title area (static + sticky header) */
function injectGlobalToggle(): void {
  const cls = 'dxp-global-toggle';

  // Try multiple injection targets (flat view → sticky header → nested view)
  // For sticky header, use .topic-header-extra (flex) instead of .title-wrapper (grid)
  // to avoid disrupting the grid layout
  const targets = [
    document.querySelector('#topic-title .title-wrapper'),
    document.querySelector('.extra-info-wrapper .topic-header-extra'),
    document.querySelector('.nested-view__header'),
  ];

  for (const target of targets) {
    if (target && !target.querySelector(`.${cls}`)) {
      const btn = document.createElement('button');
      btn.className = cls;
      btn.title = 'Discourse Xporter';
      btn.textContent = '📤';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePanel();
      });
      target.appendChild(btn);
    }
  }
}

// ==================== Outdated Note Check ====================

let outdatedCheckDone = false;

async function checkOutdatedNote(topicId: number): Promise<void> {
  if (outdatedCheckDone) return;
  outdatedCheckDone = true;

  const config = getConfig();
  if (!config.obsApiKey) return;

  const apiCfg: ObsidianApiConfig = { apiUrl: config.obsApiUrl, apiKey: config.obsApiKey };

  try {
    const outdated = await searchOutdatedByTopicId(apiCfg, topicId, FORMAT_VERSION);
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

// ==================== Batch Re-export ====================

export async function scanExportedNotes(): Promise<BatchItem[]> {
  const config = getConfig();
  const apiCfg: ObsidianApiConfig = { apiUrl: config.obsApiUrl, apiKey: config.obsApiKey };
  const origin = window.location.origin;

  const filenames = await searchByOrigin(apiCfg, origin);
  const items: BatchItem[] = [];

  for (const filename of filenames) {
    const meta = await getNoteMetadata(apiCfg, filename);
    if (meta) {
      items.push({
        path: meta.path,
        title: meta.title,
        topicId: meta.topicId,
        xporterVersion: meta.xporterVersion,
      });
    }
  }

  return items;
}

export async function doBatchReExport(
  items: BatchItem[],
  onProgress: (current: number, total: number, title: string) => void,
): Promise<{ success: number; failed: number }> {
  const config = getConfig();
  const apiCfg: ObsidianApiConfig = { apiUrl: config.obsApiUrl, apiKey: config.obsApiKey };
  const origin = window.location.origin;
  let success = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress(i + 1, items.length, item.title);

    if (i > 0) {
      await sleepRandom(config.batchDelayMin, config.batchDelayMax);
    }

    try {
      await reExportSingleTopic(item, config, apiCfg, origin);
      success++;
    } catch (err) {
      console.warn(`[DXP] Batch re-export failed for topic ${item.topicId}:`, err);
      // Retry once on 429
      if (err instanceof Error && err.message.includes('429')) {
        await sleepRandom(config.batchDelayMax * 2, config.batchDelayMax * 2);
        try {
          await reExportSingleTopic(item, config, apiCfg, origin);
          success++;
          continue;
        } catch {
          // give up
        }
      }
      failed++;
    }
  }

  return { success, failed };
}

async function reExportSingleTopic(
  item: BatchItem,
  config: Config,
  apiCfg: ObsidianApiConfig,
  origin: string,
): Promise<void> {
  const exportData = await buildTopicExport({
    topicId: item.topicId,
    origin,
    forumName: getForumName(),
    formatVersion: FORMAT_VERSION,
    config,
  });

  let md = exportData.markdown;
  const effectiveImgDir = resolveImgDir(config);

  if (config.imgMode === 'file') {
    const imageAssets = collectImageAssets(md);
    await uploadImageAssets(
      imageAssets,
      apiCfg,
      config,
      effectiveImgDir,
      item.topicId,
    );
    md = rewriteImageUrlsForObsidian(md, imageAssets, effectiveImgDir, item.topicId);
  } else if (config.imgMode === 'none') {
    md = stripImages(md);
  }

  const notePath = item.path || joinVaultPath(config.exportDir, `${exportData.safeTitle}.md`);
  await writeNote(apiCfg, notePath, md);
}

function init(): void {
  if (!isDiscourse()) return;

  console.log('[Discourse Xporter] Discourse detected, initializing…');

  // Inject styles
  injectStyles();

  // Check if on a topic page
  const info = getTopicInfo();
  if (!info) return;

  debugLog(`Topic ${info.topicId} (${info.isNested ? 'nested' : 'flat'} view)`);

  // Initialize floor buttons
  setOnCopyPost(handleCopyPost);
  initFloorButtons();

  // Initialize panel
  initPanel({
    onExportObsidian: () => doExport('obsidian'),
    onDownloadZip: () => doExport('zip'),
    onDownloadMd: () => doExport('md'),
    onBatchScan: scanExportedNotes,
    onBatchReExport: doBatchReExport,
    formatVersion: FORMAT_VERSION,
  });

  // Register menu command
  GM_registerMenuCommand('⚙️ Discourse Xporter', togglePanel);

  // Inject global toggle button + observe for SPA navigation
  injectGlobalToggle();
  const observer = new MutationObserver(() => injectGlobalToggle());
  observer.observe(document.body, { childList: true, subtree: true });

  // Async: check for outdated notes (passive reminder)
  void checkOutdatedNote(info.topicId);
}

init();
