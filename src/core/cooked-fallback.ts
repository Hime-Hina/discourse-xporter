import TurndownService from 'turndown';
import * as turndownPluginGfm from 'turndown-plugin-gfm';
import type { OneboxInfo, PipelineContext } from '../types';
import { resolveUrl } from '../utils/url';
import { floorLink } from '../utils/obsidian';

let _service: TurndownService | null = null;

function escapeMarkdownLabel(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/([\[\]])/g, '\\$1');
}

function discourseFootnoteId(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/^#/, '')
    .replace(/^fn-?/, '')
    .replace(/^fnref-?/, '')
    .replace(/^footnote-?/, '')
    .replace(/^footnote-ref-?/, '');
}

/** Get singleton Turndown instance with Discourse-specific rules */
function getService(): TurndownService {
  if (_service) return _service;

  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  service.use(turndownPluginGfm.gfm);

  // --- Custom rules for cooked-only scenarios ---

  // 1. Discourse fenced code block with language from HTML attr
  service.addRule('discourseFencedCodeBlock', {
    filter: (node) => {
      return node.nodeName === 'PRE' && node.querySelector('code') !== null;
    },
    replacement: (_content, node) => {
      const pre = node as HTMLPreElement;
      const code = pre.querySelector('code')!;
      const lang =
        pre.getAttribute('data-code-wrap') ||
        code.className.replace(/^lang-/, '').replace(/^language-/, '') ||
        '';
      const text = code.textContent || '';
      const longestRun = (text.match(/`+/g) ?? []).reduce(
        (longest, run) => Math.max(longest, run.length),
        0,
      );
      const fence = '`'.repeat(Math.max(3, longestRun + 1));
      return `\n\n${fence}${lang}\n${text}\n${fence}\n\n`;
    },
  });

  // 2. Discourse lightbox — extract original image URL
  service.addRule('discourseLightbox', {
    filter: (node) => {
      return (
        node.nodeName === 'DIV' &&
        (node as HTMLElement).classList.contains('lightbox-wrapper')
      );
    },
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const link = el.querySelector('a.lightbox') as HTMLAnchorElement | null;
      const img = el.querySelector('img') as HTMLImageElement | null;
      const href = link?.href || img?.src || '';
      const alt = img?.alt || '';
      return href ? `\n\n![${escapeMarkdownLabel(alt)}](${href})\n\n` : '';
    },
  });

  // 3. Discourse Onebox (link preview card) → callout from header + body + metadata
  service.addRule('discourseOnebox', {
    filter: (node) => {
      return (
        node.nodeName === 'ASIDE' &&
        (node as HTMLElement).classList.contains('onebox')
      );
    },
    replacement: (_content, node) =>
      renderOnebox(node as HTMLElement, (html) => service.turndown(html))
        ?.rendered ?? '',
  });

  service.addRule('discourseInlineOnebox', {
    filter: (node) =>
      node.nodeName === 'A' &&
      (node as HTMLElement).classList.contains('inline-onebox'),
    replacement: (_content, node) =>
      renderInlineOnebox(node as HTMLElement)?.rendered ?? '',
  });

  // 3b. Discourse Quote (aside.quote) — for cooked fallback
  service.addRule('discourseQuote', {
    filter: (node) => {
      return (
        node.nodeName === 'ASIDE' &&
        (node as HTMLElement).classList.contains('quote')
      );
    },
    replacement: (_content, node) =>
      renderCookedQuote(node as HTMLElement, (html) => service.turndown(html)),
  });

  // 4. Footnote reference
  service.addRule('discourseFootnoteRef', {
    filter: (node) => {
      return (
        node.nodeName === 'SUP' &&
        (node as HTMLElement).classList.contains('footnote-ref')
      );
    },
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const link = el.querySelector('a');
      const id = discourseFootnoteId(link?.getAttribute('href'));
      return id ? `[^${id}]` : '';
    },
  });

  // 5. Footnote definition item
  service.addRule('discourseFootnoteDefItem', {
    filter: (node) => {
      return (
        node.nodeName === 'LI' &&
        (node as HTMLElement).classList.contains('footnote-item')
      );
    },
    replacement: (content, node) => {
      const el = node as HTMLElement;
      const id = discourseFootnoteId(el.id);
      const text = content.replace(/\s*↩︎\s*$/, '').trim();
      return id ? `[^${id}]: ${text}\n` : '';
    },
  });

  // 6. Footnote backref — remove
  service.addRule('discourseFootnoteBackref', {
    filter: (node) => {
      return (
        node.nodeName === 'A' &&
        (node as HTMLElement).classList.contains('footnote-backref')
      );
    },
    replacement: () => '',
  });

  // 7. Footnote separator — remove
  service.addRule('discourseFootnoteSep', {
    filter: (node) => {
      return (
        node.nodeName === 'HR' &&
        (node as HTMLElement).classList.contains('footnotes-sep')
      );
    },
    replacement: () => '',
  });

  _service = service;
  return service;
}

/**
 * Convert cooked HTML to Markdown using Turndown.
 * Used as fallback when raw is unavailable or processing fails.
 */
type CookedContext = Pick<
  PipelineContext,
  'origin' | 'topicId' | 'renderedPostNumbers'
>;

/** Shared Onebox selectors and presentation for raw enhancement and fallback. */
export function renderOnebox(
  element: Element,
  convertHtml: (html: string) => string,
  origin?: string,
): OneboxInfo | undefined {
  const source =
    element.getAttribute('data-onebox-src') ||
    element.querySelector('header a[href]')?.getAttribute('href') ||
    '';
  if (!source) return undefined;
  const url = origin ? resolveUrl(source, origin) : source;
  const sections = [
    'header.source',
    'article.onebox-body',
    'div.onebox-metadata',
  ].map((selector) => {
    const section = element.querySelector(selector);
    return section ? convertHtml(section.innerHTML).trim() : '';
  });
  const [header, ...body] = sections;
  const lines = [`> [!link] ${header || url}`];
  for (const section of body) {
    if (section) lines.push(...section.split('\n').map((line) => `> ${line}`));
  }
  return { url, rendered: lines.join('\n') };
}

export function renderInlineOnebox(
  element: Element,
  origin?: string,
): OneboxInfo | undefined {
  const source = element.getAttribute('href');
  const title = element.textContent?.trim();
  if (!source || !title) return undefined;
  const url = origin ? resolveUrl(source, origin) : source;
  return { url, rendered: `[${escapeMarkdownLabel(title)}](${url})` };
}

function renderCookedQuote(
  element: Element,
  convertHtml: (html: string) => string,
  context?: CookedContext,
): string {
  const username = element.getAttribute('data-username') || '';
  const post = Number(element.getAttribute('data-post'));
  const topic = Number(element.getAttribute('data-topic')) || context?.topicId;
  const titleLink = element.querySelector('.title a[href]');
  let header = `> [!quote]${username ? ` @${username}` : ''}`;
  if (post > 0 && topic) {
    const title = titleLink?.textContent?.trim() || `#${post}`;
    if (context) {
      header += ` · ${floorLink(context.origin, topic, post, topic === context.topicId ? context.renderedPostNumbers : undefined, title)}`;
    } else {
      const href =
        titleLink?.getAttribute('href') || `/t/topic/${topic}/${post}`;
      header += ` · [${escapeMarkdownLabel(title)}](${href})`;
    }
  } else if (post > 0) header += ` · #${post}`;
  const blockquote = element.querySelector('blockquote');
  const body = blockquote ? convertHtml(blockquote.innerHTML).trim() : '';
  return `${header}\n${body
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')}`;
}

export function cookedToMarkdown(
  cookedHtml: string,
  context?: CookedContext,
): string {
  if (!cookedHtml) return '';
  if (!context || typeof DOMParser === 'undefined')
    return getService().turndown(cookedHtml);
  const document = new DOMParser().parseFromString(cookedHtml, 'text/html');
  // Normalize only the parsed content; the host page is never a source of link identity.
  for (const element of document.querySelectorAll(
    '[href], [src], [data-onebox-src]',
  )) {
    for (const attribute of ['href', 'src', 'data-onebox-src']) {
      const url = element.getAttribute(attribute);
      if (url) element.setAttribute(attribute, resolveUrl(url, context.origin));
    }
  }
  let prefix = '\uE000DXPQUOTE';
  while (cookedHtml.includes(prefix)) prefix += 'X';
  const replacements = new Map<string, string>();
  for (const element of document.querySelectorAll('aside.quote')) {
    if (!document.body.contains(element)) continue;
    const token = `${prefix}${replacements.size}\uE001`;
    replacements.set(
      token,
      renderCookedQuote(
        element,
        (html) => cookedToMarkdown(html, context),
        context,
      ),
    );
    element.replaceWith(document.createTextNode(token));
  }
  let markdown = getService().turndown(document.body);
  for (const [token, quote] of replacements)
    markdown = markdown.split(token).join(quote);
  return markdown;
}
