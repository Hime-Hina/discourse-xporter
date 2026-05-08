import TurndownService from 'turndown';
import * as turndownPluginGfm from 'turndown-plugin-gfm';

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
      return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
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
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const headerEl = el.querySelector('header.source');
      const bodyEl = el.querySelector('article.onebox-body');
      const metaEl = el.querySelector('div.onebox-metadata');

      const headerMd = headerEl
        ? service.turndown(headerEl.innerHTML).trim()
        : '';
      const bodyMd = bodyEl ? service.turndown(bodyEl.innerHTML).trim() : '';
      const metaMd = metaEl ? service.turndown(metaEl.innerHTML).trim() : '';

      const fallbackUrl =
        (el.querySelector('header a[href]') as HTMLAnchorElement | null)
          ?.href || '';
      const lines: string[] = [];
      lines.push(`> [!link] ${headerMd || fallbackUrl}`);
      if (bodyMd) {
        for (const line of bodyMd.split('\n')) lines.push(`> ${line}`);
      }
      if (metaMd) {
        for (const line of metaMd.split('\n')) lines.push(`> ${line}`);
      }
      return lines.join('\n');
    },
  });

  // 3b. Discourse Quote (aside.quote) — for cooked fallback
  service.addRule('discourseQuote', {
    filter: (node) => {
      return (
        node.nodeName === 'ASIDE' &&
        (node as HTMLElement).classList.contains('quote')
      );
    },
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const username = el.getAttribute('data-username') || '';
      const post = el.getAttribute('data-post');
      const topic = el.getAttribute('data-topic');

      // Build callout header
      let header = `> [!quote]`;
      if (username) header += ` @${username}`;

      // Title link (for quote-modified, there's a link to the source topic)
      const titleLink = el.querySelector(
        '.title a[href]',
      ) as HTMLAnchorElement | null;
      if (titleLink?.href && post && topic) {
        const title = escapeMarkdownLabel(
          titleLink.textContent?.trim() || `#${post}`,
        );
        header += ` · [${title}](${titleLink.href})`;
      } else if (post) {
        header += ` · #${post}`;
      }

      // Convert blockquote content to Markdown
      const blockquote = el.querySelector('blockquote');
      const bodyMd = blockquote
        ? service.turndown(blockquote.innerHTML).trim()
        : '';
      const quotedBody = bodyMd
        .split('\n')
        .map((line: string) => `> ${line}`)
        .join('\n');

      return `${header}\n${quotedBody}`;
    },
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
export function cookedToMarkdown(cookedHtml: string): string {
  if (!cookedHtml) return '';
  return getService().turndown(cookedHtml);
}
