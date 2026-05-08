import type { PipelineContext, OneboxInfo, QuotePreviewInfo } from '../types';
import {
  parseQuoteTag,
  parsePollTag,
  parseDateTag,
  parseDetailsTag,
} from '../utils/bbcode';
import { replaceEmoji } from './emoji-map';
import { cookedToMarkdown } from './cooked-fallback';
import { resolveUrl, topicUrl } from '../utils/url';
import { escapeObsidianAlias, unescapeMarkdownLabel } from '../utils/obsidian';

/**
 * Process raw Markdown through the full transformation pipeline.
 * Steps are applied sequentially.
 */
export function processRaw(raw: string, ctx: PipelineContext): string {
  let text = raw;

  // 1. Resolve upload:// short URLs
  text = resolveUploadShortUrls(text, ctx.uploadMap);

  // 2. Resolve relative site links → absolute URLs
  text = resolveRelativeLinks(text, ctx.origin);

  // 3. [quote] → Obsidian callout
  text = transformQuotes(text, ctx);

  // 4. [poll] → Markdown table (with JSON poll data)
  text = transformPolls(text, ctx);

  // 5. [date] → formatted date string
  text = transformDates(text);

  // 6. [details] → Obsidian collapsible callout
  text = transformDetails(text);

  // 7. Emoji :shortcode: → Unicode
  text = replaceEmoji(text);

  // 8. Onebox: bare URL → titled link (using cooked data)
  text = transformOneboxes(text, ctx);

  // 9. Quote preview: bare site URL → callout (using cooked data)
  text = transformQuotePreviews(text, ctx);

  // 10. Re-resolve relative links that steps 8/9 may have introduced
  //     (turndown of cooked HTML can produce relative links like /t/slug/123)
  text = resolveRelativeLinks(text, ctx.origin);

  // 11. Escape Markdown link labels like [[1]](#footnote) that Obsidian
  //     would otherwise read as wikilinks.
  text = escapeBracketedLinkLabels(text);

  // NOTE: Image path rewriting (rewriteImagePaths) is intentionally NOT called here.
  // It's handled at export time in main.ts to avoid premature URL replacement
  // that would prevent image collection/download.

  // 12. Make block/media boundaries explicit for Obsidian rendering.
  text = normalizeObsidianSpacing(text);

  return text;
}

// ==================== Step 1: Upload URLs ====================

export function resolveUploadShortUrls(
  text: string,
  uploadMap: Map<string, string>,
): string {
  for (const [shortUrl, fullUrl] of uploadMap) {
    // Match the short URL plus any trailing file extension (e.g. upload://abc.png)
    // to avoid partial matches that leave a dangling extension (.png.png)
    const escaped = shortUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(
      new RegExp(escaped + '(?:\\.[a-zA-Z0-9]+)?', 'g'),
      fullUrl,
    );
  }
  return text;
}

// ==================== Step 2: Relative links ====================

export function resolveRelativeLinks(text: string, origin: string): string {
  // Match markdown links with relative paths: [text](/path) or ![alt](/path)
  return text.replace(
    /(!?\[[^\]]*\])\((\/(t|u|c|tags|categories|uploads|images)[^\s)]*)\)/g,
    (_, prefix: string, path: string) =>
      `${prefix}(${resolveUrl(path, origin)})`,
  );
}

// ==================== Step 3: Quotes ====================

export function transformQuotes(text: string, ctx: PipelineContext): string {
  // Recursive: process outermost quotes, then re-process in case of nesting
  let result = text;
  let maxIter = 10; // prevent infinite loops

  while (maxIter-- > 0) {
    const quotes = parseQuoteTag(result);
    if (quotes.length === 0) break;

    for (const { params, content, fullMatch } of quotes) {
      const { username, post, topic } = params;

      // Build callout header
      let header = `> [!quote] @${username}`;
      if (post !== null) {
        const tid = topic ?? ctx.topicId;
        if (tid === ctx.topicId) {
          // Same topic: use block ref for Obsidian cross-reference
          header += ` · [[#^floor-${post}|#${post}]]`;
        } else {
          const url = topicUrl(ctx.origin, tid, post);
          header += ` · [#${post}](${url})`;
        }
      }

      // Process content: add `> ` prefix to each line
      const quotedContent = content
        .trim()
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');

      result = result.replace(fullMatch, `${header}\n${quotedContent}`);
    }
  }

  return result;
}

// ==================== Step 4: Polls ====================

export function transformPolls(text: string, ctx: PipelineContext): string {
  const polls = parsePollTag(text);
  let result = text;

  for (const { params, fullMatch } of polls) {
    // Find matching JSON poll data by name
    const jsonPoll = ctx.polls.find((p) => p.name === params.name);

    if (jsonPoll && jsonPoll.options.length > 0) {
      // Build table from JSON data (has vote counts)
      const totalVotes = jsonPoll.options.reduce((sum, o) => sum + o.votes, 0);
      const rows = jsonPoll.options.map((opt) => {
        const pct =
          totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
        return `| ${opt.html} | ${opt.votes} | ${pct}% |`;
      });

      const table = ['| 选项 | 得票 | 占比 |', '|---|---|---|', ...rows].join(
        '\n',
      );

      const statusText = jsonPoll.status === 'closed' ? '已关闭' : '进行中';
      const footer = `\n\n*投票人数: ${jsonPoll.voters} · 状态: ${statusText}*`;

      result = result.replace(fullMatch, `\n\n${table}${footer}\n\n`);
    } else {
      // No JSON data — render raw options as a list
      const list = params.options.map((opt) => `- ${opt}`).join('\n');
      result = result.replace(fullMatch, `\n\n**投票**\n\n${list}\n\n`);
    }
  }

  return result;
}

// ==================== Step 5: Dates ====================

export function transformDates(text: string): string {
  const dates = parseDateTag(text);
  let result = text;

  for (const { params, fullMatch } of dates) {
    let formatted = params.date;
    if (params.time) {
      // Trim seconds if format doesn't need them
      const timePart = params.time.replace(/:\d{2}$/, '');
      formatted += ` ${timePart}`;
    }
    if (params.timezone) {
      formatted += ` (${params.timezone})`;
    }
    result = result.replace(fullMatch, formatted);
  }

  return result;
}

// ==================== Step 6: Details ====================

export function transformDetails(text: string): string {
  let result = text;
  let maxIter = 10;

  while (maxIter-- > 0) {
    const details = parseDetailsTag(result);
    if (details.length === 0) break;

    for (const { params, fullMatch } of details) {
      const header = `> [!note]- ${params.title}`;
      const quotedContent = params.content
        .trim()
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');

      result = result.replace(fullMatch, `${header}\n${quotedContent}`);
    }
  }

  return result;
}

// ==================== Step 8: Onebox ====================

/**
 * Extract Onebox info from cooked HTML.
 * Returns a map of URL → OneboxInfo with pre-rendered callout Markdown.
 *
 * Handles two types:
 * 1. Full onebox (aside.onebox) — header.source + article.onebox-body + div.onebox-metadata → callout
 * 2. Inline onebox (a.inline-onebox) — link text replaced with page title → titled link
 */
export function extractOneboxes(cookedHtml: string): Map<string, OneboxInfo> {
  const map = new Map<string, OneboxInfo>();
  if (!cookedHtml) return map;

  const parser = typeof DOMParser !== 'undefined' ? new DOMParser() : null;
  if (!parser) return map;

  const doc = parser.parseFromString(cookedHtml, 'text/html');

  // 1. Full onebox: aside.onebox → callout
  const oneboxes = doc.querySelectorAll('aside.onebox');
  for (const aside of oneboxes) {
    let url = aside.getAttribute('data-onebox-src') ?? '';
    if (!url) {
      const headerLink = aside.querySelector(
        'header a[href]',
      ) as HTMLAnchorElement | null;
      url = headerLink?.href ?? '';
    }
    if (!url) continue;

    // Convert each section to Markdown via turndown
    const headerEl = aside.querySelector('header.source');
    const bodyEl = aside.querySelector('article.onebox-body');
    const metaEl = aside.querySelector('div.onebox-metadata');

    const headerMd = headerEl
      ? cookedToMarkdown(headerEl.innerHTML).trim()
      : '';
    const bodyMd = bodyEl ? cookedToMarkdown(bodyEl.innerHTML).trim() : '';
    const metaMd = metaEl ? cookedToMarkdown(metaEl.innerHTML).trim() : '';

    // Build callout: header as callout title, body + metadata as content
    const lines: string[] = [];
    lines.push(`> [!link] ${headerMd || url}`);
    if (bodyMd) {
      for (const line of bodyMd.split('\n')) lines.push(`> ${line}`);
    }
    if (metaMd) {
      for (const line of metaMd.split('\n')) lines.push(`> ${line}`);
    }

    map.set(url, { url, rendered: lines.join('\n') });
  }

  // 2. Inline onebox: a.inline-onebox → titled link
  const inlineOneboxes = doc.querySelectorAll('a.inline-onebox');
  for (const a of inlineOneboxes) {
    const url = (a as HTMLAnchorElement).href;
    const title = a.textContent?.trim();
    if (url && title && !map.has(url)) {
      map.set(url, { url, rendered: `[${title}](${url})` });
    }
  }

  return map;
}

/** Normalize URL for comparison (strip trailing slash, fragment, tracking params) */
function normalizeUrlForMatch(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.searchParams.delete('u');
    return u.href.replace(/\/+$/, '');
  } catch {
    return url.replace(/\/+$/, '');
  }
}

export function transformOneboxes(text: string, ctx: PipelineContext): string {
  const oneboxMap = extractOneboxes(ctx.cookedHtml);
  if (oneboxMap.size === 0) return text;

  // Build a normalized URL → OneboxInfo lookup
  const normalizedMap = new Map<string, OneboxInfo>();
  for (const [url, info] of oneboxMap) {
    normalizedMap.set(normalizeUrlForMatch(url), info);
  }

  // Replace bare URLs that appear on their own line
  return text.replace(/^(https?:\/\/\S+)$/gm, (match, rawUrl: string) => {
    const info = normalizedMap.get(normalizeUrlForMatch(rawUrl));
    if (!info) return match;
    return info.rendered;
  });
}

// ==================== Step 9: Quote Previews (bare site URL → callout) ====================

/**
 * Extract quote previews from cooked HTML.
 * Discourse renders bare URLs to other posts as `<aside class="quote quote-modified">`
 * with a blockquote containing the referenced post's content.
 */
export function extractQuotePreviews(
  cookedHtml: string,
): Map<string, QuotePreviewInfo> {
  const map = new Map<string, QuotePreviewInfo>();
  if (!cookedHtml) return map;

  const parser = typeof DOMParser !== 'undefined' ? new DOMParser() : null;
  if (!parser) return map;

  const doc = parser.parseFromString(cookedHtml, 'text/html');

  const quoteAsides = doc.querySelectorAll('aside.quote.quote-modified');
  for (const aside of quoteAsides) {
    const post = aside.getAttribute('data-post');
    const topic = aside.getAttribute('data-topic');
    if (!post || !topic) continue;

    // Extract link and title from the title section
    const titleDiv = aside.querySelector('.title');
    const titleLink = titleDiv?.querySelector(
      'a[href]',
    ) as HTMLAnchorElement | null;
    const titleText = titleLink?.textContent?.trim() ?? '';
    const url = titleLink?.href ?? '';

    // Extract avatar info
    const avatarImg = titleDiv?.querySelector(
      'img.avatar',
    ) as HTMLImageElement | null;
    const avatarUsername = avatarImg?.alt ?? '';

    // Extract blockquote body as Markdown via turndown
    const blockquote = aside.querySelector('blockquote');
    const bodyMd = blockquote
      ? cookedToMarkdown(blockquote.innerHTML).trim()
      : '';

    // Build the source URL from data attributes if not available from link
    const sourceUrl = url || `/t/topic/${topic}/${post}`;

    map.set(sourceUrl, {
      url: sourceUrl,
      title: titleText,
      topicId: parseInt(topic, 10),
      postNumber: parseInt(post, 10),
      body: bodyMd,
      username: avatarUsername,
    });
  }

  return map;
}

export function transformQuotePreviews(
  text: string,
  ctx: PipelineContext,
): string {
  const previewMap = extractQuotePreviews(ctx.cookedHtml);
  if (previewMap.size === 0) return text;

  // Build a normalized lookup
  const normalizedMap = new Map<string, QuotePreviewInfo>();
  for (const [url, info] of previewMap) {
    normalizedMap.set(normalizeUrlForMatch(resolveUrl(url, ctx.origin)), info);
  }

  // Replace bare URLs that match quote previews
  return text.replace(/^(https?:\/\/\S+)$/gm, (match, rawUrl: string) => {
    const info = normalizedMap.get(normalizeUrlForMatch(rawUrl));
    if (!info) return match;

    // Build callout header
    let header = '> [!quote]';
    if (info.title) {
      header += ` ${info.title}`;
    }

    // Build floor reference
    let floorRef: string;
    if (info.topicId === ctx.topicId) {
      floorRef = `[[#^floor-${info.postNumber}|#${info.postNumber}]]`;
    } else {
      const url = topicUrl(ctx.origin, info.topicId, info.postNumber);
      floorRef = `[#${info.postNumber}](${url})`;
    }
    header += ` · ${floorRef}`;

    // Build quoted body
    const quotedBody = info.body
      ? '\n' +
        info.body
          .split('\n')
          .map((line: string) => `> ${line}`)
          .join('\n')
      : '';

    return `${header}${quotedBody}`;
  });
}

// ==================== Obsidian spacing normalization ====================

export function normalizeObsidianSpacing(text: string): string {
  if (!text) return text;

  const lines = text.split('\n');
  const out: string[] = [];
  let inFence = false;
  let fenceMarker = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^ {0,3}(```+|~~~+)/);

    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
      out.push(line);
      continue;
    }

    if (inFence) {
      out.push(line);
      continue;
    }

    if (startsStandaloneBlock(line) && needsBlankBefore(out, line)) {
      out.push('');
    }

    out.push(line);

    const next = lines[i + 1];
    if (
      next !== undefined &&
      endsStandaloneBlock(line, next) &&
      next.trim() !== ''
    ) {
      out.push('');
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

function startsStandaloneBlock(line: string): boolean {
  return isQuoteLine(line) || isStandaloneImageLine(line);
}

function endsStandaloneBlock(line: string, next: string): boolean {
  if (isStandaloneImageLine(line)) return !isStandaloneImageLine(next);
  if (isQuoteLine(line)) return !isQuoteLine(next);
  return false;
}

function needsBlankBefore(out: string[], line: string): boolean {
  const previous = out[out.length - 1];
  if (previous === undefined || previous.trim() === '') return false;
  if (isQuoteLine(line) && isQuoteLine(previous)) return false;
  if (isStandaloneImageLine(line) && isStandaloneImageLine(previous))
    return false;
  return true;
}

function isQuoteLine(line: string): boolean {
  return /^>\s?/.test(line);
}

function isStandaloneImageLine(line: string): boolean {
  return (
    /^\s*!\[(?:\\.|[^\]\\])*\]\([^)]+\)\s*$/.test(line) ||
    /^\s*!\[\[.+\]\]\s*$/.test(line)
  );
}

// ==================== Link label escaping ====================

export function escapeBracketedLinkLabels(text: string): string {
  if (!text) return text;

  return transformOutsideFences(text, (line) =>
    line.replace(
      /(^|[^!\\])\[\[([^\]\n]+)\]\]\(([^)\s]+)\)/g,
      (_, prefix: string, label: string, href: string) =>
        `${prefix}[\\[${label}\\]](${href})`,
    ),
  );
}

function transformOutsideFences(
  text: string,
  transformLine: (line: string) => string,
): string {
  const lines = text.split('\n');
  let inFence = false;
  let fenceMarker = '';

  return lines
    .map((line) => {
      const fence = line.match(/^ {0,3}(```+|~~~+)/);
      if (fence) {
        if (!inFence) {
          inFence = true;
          fenceMarker = fence[1][0];
        } else if (fence[1][0] === fenceMarker) {
          inFence = false;
          fenceMarker = '';
        }
        return line;
      }

      return inFence ? line : transformLine(line);
    })
    .join('\n');
}

// ==================== Image path rewriting ====================

export function rewriteImagePaths(text: string, ctx: PipelineContext): string {
  const { imgMode, imgDir } = ctx.config;

  if (imgMode === 'embed' || imgMode === 'none') return text;

  if (imgMode === 'file') {
    // Obsidian wikilink format: ![[filename|alt]]
    return text.replace(
      /!\[((?:\\.|[^\]\\])*)\]\((https?:\/\/[^\s)]+)\)/g,
      (_, alt: string, url: string) => {
        const filename = extractImageFilename(url);
        const alias = escapeObsidianAlias(unescapeMarkdownLabel(alt));
        return alias ? `![[${filename}|${alias}]]` : `![[${filename}]]`;
      },
    );
  }

  return text;
}

function extractImageFilename(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return pathname.split('/').pop() || 'image';
  } catch {
    return 'image';
  }
}
