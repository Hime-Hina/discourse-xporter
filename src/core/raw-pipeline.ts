import type { PipelineContext, OneboxInfo, QuotePreviewInfo } from '../types';
import {
  parseQuoteTag,
  parsePollTag,
  parseDateTag,
  parseDetailsTag,
} from '../utils/bbcode';
import { replaceEmoji } from './emoji-map';
import {
  cookedToMarkdown,
  renderOnebox,
  renderInlineOnebox,
} from './cooked-fallback';
import { resolveUrl } from '../utils/url';
import { floorLink } from '../utils/obsidian';
import {
  protectMarkdownCode,
  transformOutsideCode,
} from '../utils/markdown-code';
import type { SourceRange } from '../utils/bbcode';

/**
 * Process raw Markdown through the full transformation pipeline.
 * Steps are applied sequentially.
 */
export function processRaw(raw: string, ctx: PipelineContext): string {
  const code = protectMarkdownCode(raw);
  let text = code.text;
  const cookedDocument = parseCookedDocument(ctx.cookedHtml);

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
  text = transformOneboxes(text, ctx, cookedDocument);

  // 9. Quote preview: bare site URL → callout (using cooked data)
  text = transformQuotePreviews(text, ctx, cookedDocument);

  // 10. Re-resolve relative links that steps 8/9 may have introduced
  //     (turndown of cooked HTML can produce relative links like /t/slug/123)
  text = resolveRelativeLinks(text, ctx.origin);

  // 11. Escape Markdown link labels like [[1]](#footnote) that Obsidian
  //     would otherwise read as wikilinks.
  text = escapeBracketedLinkLabels(text);

  // Image path rewriting is export-layer behavior; raw output must keep source URLs.

  // 12. Make block/media boundaries explicit for Obsidian rendering.
  text = normalizeObsidianSpacing(text);

  return code.restore(text);
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
      () => fullUrl,
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

const MAX_BBCODE_DEPTH = 64;

export function transformQuotes(text: string, ctx: PipelineContext): string {
  return transformOutsideCode(text, (prose) => renderQuotes(prose, ctx, 0));
}

function renderQuotes(
  text: string,
  ctx: PipelineContext,
  depth: number,
): string {
  const quotes = parseQuoteTag(text);
  if (quotes.length === 0) return text;
  if (depth >= MAX_BBCODE_DEPTH) {
    console.warn(
      '[DXP] Quote nesting exceeds 64 levels; preserving remaining source',
    );
    return text;
  }
  return replaceSourceRanges(text, quotes, ({ params, content }) => {
    const { username, post, topic } = params;
    let header = `> [!quote]${username ? ` @${username}` : ''}`;
    if (post !== null) {
      const tid = topic ?? ctx.topicId;
      header += ` · ${floorLink(ctx.origin, tid, post, tid === ctx.topicId ? ctx.renderedPostNumbers : undefined)}`;
    }
    const body = renderQuotes(content, ctx, depth + 1).trim();
    return `${header}\n${body
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')}`;
  });
}

// ==================== Step 4: Polls ====================

export function transformPolls(text: string, ctx: PipelineContext): string {
  const polls = parsePollTag(text);
  return replaceSourceRanges(text, polls, ({ params }) => {
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

      return `\n\n${table}${footer}\n\n`;
    } else {
      // No JSON data — render raw options as a list
      const list = params.options.map((opt) => `- ${opt}`).join('\n');
      return `\n\n**投票**\n\n${list}\n\n`;
    }
  });
}

// ==================== Step 5: Dates ====================

export function transformDates(text: string): string {
  return replaceSourceRanges(text, parseDateTag(text), ({ params }) => {
    let formatted = params.date;
    if (params.time) {
      const timePart = /^\d{2}:\d{2}:\d{2}$/.test(params.time)
        ? params.time.slice(0, 5)
        : params.time;
      formatted += ` ${timePart}`;
    }
    if (params.timezone) formatted += ` (${params.timezone})`;
    return formatted;
  });
}

// ==================== Step 6: Details ====================

export function transformDetails(text: string): string {
  return transformOutsideCode(text, (prose) =>
    transformHtmlDetails(renderDetails(prose, 0)),
  );
}

function renderDetails(text: string, depth: number): string {
  const details = parseDetailsTag(text);
  if (details.length === 0) return text;
  if (depth >= MAX_BBCODE_DEPTH) {
    console.warn(
      '[DXP] Details nesting exceeds 64 levels; preserving remaining source',
    );
    return text;
  }
  return replaceSourceRanges(text, details, ({ params }) => {
    const body = renderDetails(params.content, depth + 1).trim();
    return `> [!note]- ${params.title}\n${body
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')}`;
  });
}

export function transformHtmlDetails(text: string): string {
  const tags = /<details\b[^>]*>|<\/details\s*>/gi;
  const ranges: (SourceRange & {
    opening: string;
    content: string;
    fullMatch: string;
  })[] = [];
  let outer:
    | { start: number; contentStart: number; opening: string }
    | undefined;
  let depth = 0;
  let token: RegExpExecArray | null;
  while ((token = tags.exec(text))) {
    if (!/^<\//.test(token[0])) {
      if (depth === 0)
        outer = {
          start: token.index,
          contentStart: tags.lastIndex,
          opening: token[0],
        };
      depth++;
    } else if (depth > 0 && --depth === 0 && outer) {
      ranges.push({
        startIndex: outer.start,
        endIndex: tags.lastIndex,
        opening: outer.opening,
        content: text.slice(outer.contentStart, token.index),
        fullMatch: text.slice(outer.start, tags.lastIndex),
      });
      outer = undefined;
    }
  }
  return replaceSourceRanges(
    text,
    ranges,
    ({ content, opening, fullMatch }) => {
      // Nested HTML details are retained intact rather than partially truncating them.
      if (/<details\b/i.test(content)) return fullMatch;
      const summary = content.match(
        /^\s*<summary\b[^>]*>([\s\S]*?)<\/summary\s*>([\s\S]*)$/i,
      );
      if (!summary) return fullMatch;
      const title = htmlFragmentToMarkdown(summary[1])
        .replace(/\s+/g, ' ')
        .trim();
      const body = htmlFragmentToMarkdown(summary[2]).trim();
      const expanded = /\sopen(?:\s|=|>)/i.test(opening);
      return `> [!note]${expanded ? '+' : '-'} ${title}\n${body
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')}`;
    },
  );
}

function htmlFragmentToMarkdown(fragment: string): string {
  if (!/<[a-z][\s\S]*>/i.test(fragment)) return fragment.trim();
  return cookedToMarkdown(fragment).trim();
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
function parseCookedDocument(cookedHtml: string): Document | undefined {
  if (!cookedHtml || typeof DOMParser === 'undefined') return undefined;
  return new DOMParser().parseFromString(cookedHtml, 'text/html');
}

export function extractOneboxes(cookedHtml: string): Map<string, OneboxInfo> {
  return oneboxesFromDocument(parseCookedDocument(cookedHtml));
}

function oneboxesFromDocument(
  document?: Document,
  ctx?: PipelineContext,
): Map<string, OneboxInfo> {
  const map = new Map<string, OneboxInfo>();
  if (!document) return map;
  for (const element of document.querySelectorAll('aside.onebox')) {
    const onebox = renderOnebox(
      element,
      (html) => cookedToMarkdown(html, ctx),
      ctx?.origin,
    );
    if (onebox) map.set(onebox.url, onebox);
  }
  for (const element of document.querySelectorAll('a.inline-onebox')) {
    const onebox = renderInlineOnebox(element, ctx?.origin);
    if (onebox && !map.has(onebox.url)) map.set(onebox.url, onebox);
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

export function transformOneboxes(
  text: string,
  ctx: PipelineContext,
  document = parseCookedDocument(ctx.cookedHtml),
): string {
  const oneboxMap = oneboxesFromDocument(document, ctx);
  if (oneboxMap.size === 0) return text;

  // Build a normalized URL → OneboxInfo lookup
  const normalizedMap = new Map<string, OneboxInfo>();
  for (const [url, onebox] of oneboxMap) {
    normalizedMap.set(
      normalizeUrlForMatch(resolveUrl(url, ctx.origin)),
      onebox,
    );
  }

  // Replace bare URLs that appear on their own line
  return replaceBareDiscourseLinks(text, ctx.origin, (rawUrl) => {
    const onebox = normalizedMap.get(
      normalizeUrlForMatch(resolveUrl(rawUrl, ctx.origin)),
    );
    return onebox?.rendered;
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
  return quotePreviewsFromDocument(parseCookedDocument(cookedHtml));
}

function quotePreviewsFromDocument(
  doc?: Document,
  ctx?: PipelineContext,
): Map<string, QuotePreviewInfo> {
  const map = new Map<string, QuotePreviewInfo>();
  if (!doc) return map;

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
    const url = titleLink?.getAttribute('href') ?? '';

    // Extract avatar info
    const avatarImg = titleDiv?.querySelector(
      'img.avatar',
    ) as HTMLImageElement | null;
    const avatarUsername = avatarImg?.alt ?? '';

    // Extract blockquote body as Markdown via turndown
    const blockquote = aside.querySelector('blockquote');
    const bodyMd = blockquote
      ? cookedToMarkdown(blockquote.innerHTML, ctx).trim()
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
  document = parseCookedDocument(ctx.cookedHtml),
): string {
  const previewMap = quotePreviewsFromDocument(document, ctx);
  if (previewMap.size === 0) return text;

  // Build a normalized lookup
  const normalizedMap = new Map<string, QuotePreviewInfo>();
  for (const [url, preview] of previewMap) {
    normalizedMap.set(
      normalizeUrlForMatch(resolveUrl(url, ctx.origin)),
      preview,
    );
  }

  // Replace bare URLs that match quote previews
  return replaceBareDiscourseLinks(text, ctx.origin, (rawUrl) => {
    const preview = normalizedMap.get(
      normalizeUrlForMatch(resolveUrl(rawUrl, ctx.origin)),
    );
    if (!preview) return undefined;

    // Build callout header
    let header = '> [!quote]';
    if (preview.title) {
      header += ` ${preview.title}`;
    }

    // Build floor reference
    const floorRef = floorLink(
      ctx.origin,
      preview.topicId,
      preview.postNumber,
      preview.topicId === ctx.topicId ? ctx.renderedPostNumbers : undefined,
    );
    header += ` · ${floorRef}`;

    // Build quoted body
    const quotedBody = preview.body
      ? '\n' +
        preview.body
          .split('\n')
          .map((line: string) => `> ${line}`)
          .join('\n')
      : '';

    return `${header}${quotedBody}`;
  });
}

function replaceBareDiscourseLinks(
  text: string,
  origin: string,
  replacementForUrl: (url: string) => string | undefined,
): string {
  return text.replace(
    /^((?:https?:\/\/|\/(?:t|u|c|tags|categories|uploads|images)\/)\S+)$/gm,
    (match: string, rawUrl: string) => {
      const replacement = replacementForUrl(resolveUrl(rawUrl, origin));
      return replacement ?? match;
    },
  );
}

// ==================== Obsidian spacing normalization ====================

export function normalizeObsidianSpacing(text: string): string {
  return transformOutsideCode(text, (prose) => {
    const lines = prose.split('\n');
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (startsStandaloneBlock(line) && needsBlankBefore(out, line))
        out.push('');
      out.push(line);
      const next = lines[i + 1];
      if (
        next !== undefined &&
        endsStandaloneBlock(line, next) &&
        next.trim() !== ''
      )
        out.push('');
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n');
  });
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
  return transformOutsideCode(text, (prose) =>
    prose.replace(
      /(^|[^!\\])\[\[([^\]\n]+)\]\]\(([^)\s]+)\)/g,
      (_, prefix: string, label: string, href: string) =>
        `${prefix}[\\[${label}\\]](${href})`,
    ),
  );
}

function replaceSourceRanges<T extends SourceRange>(
  text: string,
  ranges: T[],
  render: (range: T) => string,
): string {
  let output = '';
  let cursor = 0;
  for (const range of ranges) {
    output += text.slice(cursor, range.startIndex) + render(range);
    cursor = range.endIndex;
  }
  return output + text.slice(cursor);
}
