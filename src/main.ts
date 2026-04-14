import type {
  Config,
  DiscoursePost,
  DiscourseTopic,
  PipelineContext,
  ProcessedPost,
  ProgressCallback,
} from './types';
import { getConfig } from './config/storage';
import {
  fetchTopic,
  fetchAllPosts,
  resolveUploadUrls,
  fetchCategoryName,
  fetchBinary,
} from './core/api';
import {
  processPost,
  buildFrontmatter,
  assembleDocument,
} from './core/formatter';
import { processRaw } from './core/raw-pipeline';
import { cookedToMarkdown } from './core/cooked-fallback';
import { copyToClipboard } from './export/clipboard';
import { downloadFile } from './export/download';
import { buildZip } from './export/zip-export';
import {
  testConnection,
  searchByTopicId,
  noteExists,
  writeNote,
  writeBinary,
  openNote,
} from './export/obsidian-api';
import { injectStyles } from './ui/styles';
import { showToast } from './ui/toast';
import {
  initPanel,
  updateProgress,
  resetProgress,
  getPanelFilterConfig,
  togglePanel,
} from './ui/panel';
import {
  initFloorButtons,
  setOnCopyPost,
  getSelectedPosts,
  clearSelectedPosts,
} from './ui/floor-buttons';
import { safeFilename, extractFilename } from './utils/filename';
import { isEmojiUrl, isAvatarUrl, topicUrl } from './utils/url';
import { DEFAULT_FLOOR_TEMPLATE } from './config/defaults';

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

// ==================== Image Collection ====================

/** Format a Date as YYYY-MM-DDTHH:mm:ss in UTC+8 (Obsidian Date & Time format) */
function toLocalISO(date: Date): string {
  const d = new Date(date.getTime() + 8 * 3600_000);
  return d.toISOString().slice(0, 19);
}

/** Resolve the effective image directory path based on imgDirMode */
function resolveImgDir(config: Config): string {
  if (config.imgDirMode === 'absolute') return config.imgDir;
  // relative mode: relative to exportDir
  if (!config.imgDir) return config.exportDir;
  return `${config.exportDir}/${config.imgDir}`;
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

function collectImageUrls(markdown: string): Map<string, string> {
  const urlToFilename = new Map<string, string>();
  const regex = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = regex.exec(markdown)) !== null) {
    const url = match[1];
    if (isEmojiUrl(url) || isAvatarUrl(url)) continue;
    if (!urlToFilename.has(url)) {
      urlToFilename.set(url, extractFilename(url, index++));
    }
  }
  return urlToFilename;
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

  try {
    // 1. Fetch topic
    debugLog('Starting export, mode:', mode, 'topicId:', info.topicId);
    updateProgress('获取话题信息…', 0);
    const topic = await fetchTopic(info.topicId);

    // 2. Fetch all posts
    const allPosts = await fetchAllPosts(
      info.topicId,
      topic.post_stream.stream,
      topic.post_stream.posts,
      config,
      updateProgress,
    );

    // 3. Collect & resolve upload:// URLs
    updateProgress('解析资源链接…', 0.5);
    const allUploadUrls: string[] = [];
    for (const p of allPosts) {
      if (p.raw) {
        const matches = p.raw.match(/upload:\/\/[a-zA-Z0-9._-]+/g);
        if (matches) allUploadUrls.push(...matches);
      }
    }
    const uploadMap = await resolveUploadUrls(allUploadUrls);
    debugLog(
      'Resolved',
      uploadMap.size,
      'upload URLs from',
      allUploadUrls.length,
      'short URLs',
    );

    // 4. Get category name
    const categoryName = await fetchCategoryName(topic.category_id);

    // 5. Apply filters
    let filteredPosts = applyFilters(allPosts, topic, filters);

    // 6. Process posts
    debugLog(
      'Processing',
      filteredPosts.length,
      'posts (filtered from',
      allPosts.length,
      ')',
    );
    updateProgress('处理内容…', 0.6);
    const origin = window.location.origin;
    const selectedSet = getSelectedPosts();

    const processedPosts: ProcessedPost[] = filteredPosts.map((post) => {
      const ctx: PipelineContext = {
        origin,
        topicId: info.topicId,
        topicSlug: topic.slug,
        polls: post.polls ?? [],
        cookedHtml: post.cooked,
        config,
        uploadMap,
      };
      return processPost(
        post,
        topic.user_id,
        ctx,
        selectedSet.has(post.post_number),
      );
    });

    // 7. Build document
    const forumName = getForumName();
    const forumTag = forumName.replace(/\s+/g, '-');
    const tags =
      topic.tags?.map((t) => (typeof t === 'string' ? t : t.name)) ?? [];
    tags.push(forumTag);

    const frontmatter = buildFrontmatter({
      title: topic.title,
      source: `${origin}/t/topic/${info.topicId}`,
      author: topic.details.created_by.username,
      category: categoryName,
      forum: forumName,
      tags,
      created: toLocalISO(new Date(topic.created_at)),
      exported: toLocalISO(new Date()),
      topic_id: info.topicId,
      slug: topic.slug,
      posts_count: topic.posts_count,
      reply_count: topic.reply_count,
      views: topic.views,
      likes: topic.like_count,
      word_count: topic.word_count ?? 0,
      participants: topic.participant_count,
      closed: topic.closed,
      archived: topic.archived,
    });

    const template = config.floorTemplate || DEFAULT_FLOOR_TEMPLATE;
    const markdown = assembleDocument(
      frontmatter,
      processedPosts,
      template,
      origin,
      info.topicId,
    );
    const safeTitle = safeFilename(topic.title);

    // 8. Export based on mode
    if (mode === 'md') {
      downloadFile(markdown, `${safeTitle}.md`, 'text/markdown;charset=utf-8');
      showToast('Markdown 下载完成 ✓');
    } else if (mode === 'zip') {
      await exportAsZip(markdown, safeTitle, info.topicId, config);
    } else if (mode === 'obsidian') {
      await exportToObsidian(markdown, safeTitle, info.topicId, config);
    }
  } catch (err) {
    console.error('[Discourse Xporter]', err);
    showToast(
      `导出失败: ${err instanceof Error ? err.message : String(err)}`,
      'error',
      5000,
    );
  } finally {
    resetProgress();
  }
}

async function exportAsZip(
  markdown: string,
  safeTitle: string,
  topicId: number,
  config: Config,
): Promise<void> {
  const imageUrls = collectImageUrls(markdown);

  if (imageUrls.size === 0) {
    downloadFile(markdown, `${safeTitle}.md`, 'text/markdown;charset=utf-8');
    showToast('无图片，已下载纯 Markdown ✓');
    return;
  }

  // Rewrite image paths for ZIP
  const effectiveImgDir = resolveImgDir(config);
  let md = markdown;
  for (const [url, filename] of imageUrls) {
    md = md.replaceAll(url, `${effectiveImgDir}/${topicId}/${filename}`);
  }

  // Download images
  const images = new Map<string, Uint8Array>();
  const entries = [...imageUrls.entries()];
  let downloaded = 0;

  for (let i = 0; i < entries.length; i += config.imageConcurrency) {
    if (i > 0) {
      const delay =
        Math.floor(
          Math.random() * (config.imageDelayMax - config.imageDelayMin + 1),
        ) + config.imageDelayMin;
      await new Promise((r) => setTimeout(r, delay));
    }
    const chunk = entries.slice(i, i + config.imageConcurrency);
    const promises = chunk.map(async ([url, filename]) => {
      try {
        const binary = await fetchBinary(url);
        images.set(filename, binary);
      } catch {
        console.warn(`[DXP] Image download failed: ${url}`);
      } finally {
        downloaded++;
        updateProgress(
          `下载图片 ${downloaded}/${imageUrls.size}`,
          downloaded / imageUrls.size,
        );
      }
    });
    await Promise.all(promises);
  }

  updateProgress('打包 ZIP…', 1);
  const zipBytes = buildZip(
    `${safeTitle}.md`,
    md,
    effectiveImgDir,
    topicId,
    images,
  );
  downloadFile(
    new Blob([zipBytes.buffer as ArrayBuffer], { type: 'application/zip' }),
    `${safeTitle}.zip`,
    'application/zip',
  );
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

  const notePath = `${config.exportDir}/${safeTitle}.md`;

  // Check existing
  const exists = await noteExists(apiCfg, notePath);
  if (exists && config.obsWriteMode === 'overwrite') {
    // Could prompt user, for now just overwrite
  }

  let md = markdown;
  const effectiveImgDir = resolveImgDir(config);

  if (config.imgMode === 'file') {
    // Collect image URLs BEFORE rewriting
    const imageUrls = collectImageUrls(md);
    debugLog(`[Obsidian] Found ${imageUrls.size} images to upload`);

    // Download and upload images
    if (imageUrls.size > 0) {
      let uploaded = 0;
      for (const [url, filename] of imageUrls) {
        try {
          updateProgress(
            `上传图片 ${++uploaded}/${imageUrls.size}`,
            uploaded / imageUrls.size,
          );
          const binary = await fetchBinary(url);
          const imgPath = `${effectiveImgDir}/${topicId}/${filename}`;
          const mime = guessMime(filename);
          await writeBinary(apiCfg, imgPath, binary, mime);
        } catch {
          console.warn(`[DXP] Image upload failed: ${url}`);
        }
      }
    }

    // Rewrite image paths to Obsidian wikilinks
    md = rewriteImagePathsForObsidian(md, topicId, effectiveImgDir);
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

function guessMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
  };
  return mimes[ext ?? ''] ?? 'application/octet-stream';
}

// ==================== Image Path Helpers ====================

/** Rewrite standard markdown image links to Obsidian wikilinks: ![[dir/topicId/filename|alt]] */
function rewriteImagePathsForObsidian(
  markdown: string,
  topicId: number,
  imgDir: string,
): string {
  return markdown.replace(
    /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, alt: string, url: string) => {
      const filename = extractImageFilename(url);
      const path = `${imgDir}/${topicId}/${filename}`;
      return alt ? `![[${path}|${alt}]]` : `![[${path}]]`;
    },
  );
}

/** Extract filename from a URL */
function extractImageFilename(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return pathname.split('/').pop() || 'image';
  } catch {
    return 'image';
  }
}

/** Strip all image markdown from text */
function stripImages(markdown: string): string {
  return markdown.replace(/!\[([^\]]*)\]\([^\s)]+\)/g, '$1');
}

// ==================== Filters ====================

interface FilterConfig {
  rangeMode: string;
  rangeStart: number;
  rangeEnd: number;
  onlyOp: boolean;
  imgFilter: string;
  users: string[];
  includeKeywords: string[];
  excludeKeywords: string[];
  minLength: number;
}

function applyFilters(
  posts: DiscoursePost[],
  topic: DiscourseTopic,
  filters: FilterConfig,
): DiscoursePost[] {
  let result = posts;

  // Range filter
  if (filters.rangeMode === 'range') {
    result = result.filter(
      (p) =>
        p.post_number >= filters.rangeStart &&
        p.post_number <= filters.rangeEnd,
    );
  } else if (filters.rangeMode === 'selected') {
    const sel = getSelectedPosts();
    result = result.filter((p) => sel.has(p.post_number));
  }

  // Only OP
  if (filters.onlyOp) {
    result = result.filter((p) => p.user_id === topic.user_id);
  }

  // Image filter
  if (filters.imgFilter === 'withImg') {
    result = result.filter((p) => /!\[.*?\]\(.*?\)/.test(p.raw ?? p.cooked));
  } else if (filters.imgFilter === 'noImg') {
    result = result.filter((p) => !/!\[.*?\]\(.*?\)/.test(p.raw ?? p.cooked));
  }

  // User filter
  if (filters.users.length > 0) {
    const userSet = new Set(filters.users.map((u) => u.toLowerCase()));
    result = result.filter((p) => userSet.has(p.username.toLowerCase()));
  }

  // Keyword include
  if (filters.includeKeywords.length > 0) {
    result = result.filter((p) => {
      const text = (p.raw ?? p.cooked).toLowerCase();
      return filters.includeKeywords.some((kw) =>
        text.includes(kw.toLowerCase()),
      );
    });
  }

  // Keyword exclude
  if (filters.excludeKeywords.length > 0) {
    result = result.filter((p) => {
      const text = (p.raw ?? p.cooked).toLowerCase();
      return !filters.excludeKeywords.some((kw) =>
        text.includes(kw.toLowerCase()),
      );
    });
  }

  // Min length
  if (filters.minLength > 0) {
    result = result.filter(
      (p) => (p.raw ?? p.cooked).length >= filters.minLength,
    );
  }

  return result;
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
  });

  // Register menu command
  GM_registerMenuCommand('⚙️ Discourse Xporter', togglePanel);

  // Inject global toggle button + observe for SPA navigation
  injectGlobalToggle();
  const observer = new MutationObserver(() => injectGlobalToggle());
  observer.observe(document.body, { childList: true, subtree: true });
}

init();
