import { markdownCodeRanges, protectMarkdownCode } from './markdown-code';
import { isAvatarUrl, isEmojiUrl } from './url';

export interface MarkdownLink {
  start: number;
  end: number;
  label: string;
  url: string;
  image: boolean;
}

export interface MarkdownImage extends MarkdownLink {
  alt: string;
}

function unescape(value: string): string {
  return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');
}

function referenceKey(value: string): string {
  return unescape(value).trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Export metadata is not Markdown content and must never schedule attachments. */
export function markdownBodyOffset(markdown: string): number {
  const opening = markdown.match(/^\uFEFF?---[ \t]*\r?\n/);
  if (!opening) return 0;
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm;
  closing.lastIndex = opening[0].length;
  const match = closing.exec(markdown);
  if (!match) return 0;
  const metadata = markdown.slice(opening[0].length, match.index);
  return /^[A-Za-z_][\w-]*:[ \t]/m.test(metadata) ? closing.lastIndex : 0;
}

function titleEnd(text: string, start: number): number | undefined {
  const opener = text[start];
  if (!['"', "'", '('].includes(opener)) return undefined;
  const closer = opener === '(' ? ')' : opener;
  for (let cursor = start + 1; cursor < text.length; cursor++) {
    if (text[cursor] === '\\') cursor++;
    else if (text[cursor] === closer) return cursor + 1;
    else if (
      text[cursor] === '\n' &&
      /^[ \t]*\r?\n/.test(text.slice(cursor + 1))
    )
      return undefined;
  }
  return undefined;
}

function definitionEnd(
  text: string,
  destinationEnd: number,
): number | undefined {
  const lineEnd = text.indexOf('\n', destinationEnd);
  const end = lineEnd < 0 ? text.length : lineEnd;
  const tail = text.slice(destinationEnd, end);
  const sameLineStart =
    destinationEnd + (tail.match(/^[ \t]*/)?.[0].length ?? 0);
  if (tail.trim()) {
    const title = titleEnd(text, sameLineStart);
    if (title === undefined || !/^[ \t]*\r?(?:\n|$)/.test(text.slice(title)))
      return undefined;
    const endTitleLine = text.indexOf('\n', title);
    return endTitleLine < 0 ? text.length : endTitleLine;
  }
  if (lineEnd < 0) return end;
  const nextStart = lineEnd + 1;
  const indent =
    text.slice(nextStart).match(/^(?: {0,3}>[ \t]?)*[ \t]*/)?.[0].length ?? 0;
  const title = titleEnd(text, nextStart + indent);
  if (title !== undefined && /^[ \t]*\r?(?:\n|$)/.test(text.slice(title))) {
    const endTitleLine = text.indexOf('\n', title);
    return endTitleLine < 0 ? text.length : endTitleLine;
  }
  return end;
}

/** Read a Markdown destination; balanced parentheses and escapes are significant. */
function destination(
  text: string,
  start: number,
): { url: string; end: number } | undefined {
  let cursor = start;
  if (text[cursor] === '<') {
    cursor++;
    const begin = cursor;
    while (cursor < text.length && text[cursor] !== '\n') {
      if (text[cursor] === '\\') cursor += 2;
      else if (text[cursor] === '>')
        return { url: unescape(text.slice(begin, cursor)), end: cursor + 1 };
      else cursor++;
    }
    return undefined;
  }
  let depth = 0;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    if (char === '(') depth++;
    else if (char === ')') {
      if (depth === 0) break;
      depth--;
    } else if (/\s/.test(char)) break;
    cursor++;
  }
  if (cursor === start || depth !== 0) return undefined;
  return { url: unescape(text.slice(start, cursor)), end: cursor };
}

/** The same source offsets drive collection, replacement and image filtering. */
export function findMarkdownLinks(markdown: string): MarkdownLink[] {
  const bodyOffset = markdownBodyOffset(markdown);
  const code = markdownCodeRanges(markdown.slice(bodyOffset)).map((range) => ({
    start: range.start + bodyOffset,
    end: range.end + bodyOffset,
  }));
  const excluded = (offset: number): boolean =>
    offset < bodyOffset ||
    code.some((range) => offset >= range.start && offset < range.end);
  const definitions = new Map<string, string>();
  const definitionRanges: { start: number; end: number }[] = [];
  const destinationRanges: { start: number; end: number }[] = [];
  for (const match of markdown.matchAll(
    /^(?: {0,3}>[ \t]?)* {0,3}\[((?:\\.|[^\[\]\\])+)\]:[ \t]*(?:\r?\n(?: {0,3}>[ \t]?)*[ \t]*)?/gm,
  )) {
    if (excluded(match.index)) continue;
    const target = destination(markdown, match.index + match[0].length);
    if (!target) continue;
    const end = definitionEnd(markdown, target.end);
    if (end === undefined) continue;
    const key = referenceKey(match[1]);
    if (!definitions.has(key)) definitions.set(key, target.url);
    definitionRanges.push({
      start: match.index,
      end,
    });
  }

  const links: MarkdownLink[] = [];
  for (let start = 0; start < markdown.length; start++) {
    if (
      excluded(start) ||
      definitionRanges.some(
        (range) => start >= range.start && start < range.end,
      ) ||
      destinationRanges.some(
        (range) => start >= range.start && start < range.end,
      )
    )
      continue;
    if (markdown[start] === '\\') {
      start++;
      continue;
    }
    const image = markdown[start] === '!' && markdown[start + 1] === '[';
    const open = image ? start + 1 : start;
    if (markdown[open] !== '[' || markdown[open + 1] === '[') continue;
    let cursor = open + 1;
    let depth = 1;
    for (; cursor < markdown.length; cursor++) {
      if (markdown[cursor] === '\\') {
        cursor++;
        continue;
      }
      if (markdown[cursor] === '[') depth++;
      if (markdown[cursor] === ']') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) continue;
    const label = markdown.slice(open + 1, cursor);
    let end = cursor + 1;
    let url: string | undefined;
    if (markdown[end] === '(') {
      let at = end + 1;
      while (/[ \t\n]/.test(markdown[at] ?? '') && at < markdown.length) at++;
      const target = destination(markdown, at);
      if (!target) continue;
      at = target.end;
      const whitespace = at;
      while (/[ \t\n]/.test(markdown[at] ?? '') && at < markdown.length) at++;
      if (at > whitespace && ['"', "'", '('].includes(markdown[at])) {
        const title = titleEnd(markdown, at);
        if (title === undefined) continue;
        at = title;
        while (/[ \t\n]/.test(markdown[at] ?? '') && at < markdown.length) at++;
      }
      if (markdown[at] !== ')') continue;
      url = target.url;
      end = at + 1;
    } else if (markdown[end] === '[') {
      let close = end + 1;
      while (close < markdown.length && markdown[close] !== ']') {
        if (markdown[close] === '\\') close++;
        close++;
      }
      if (close >= markdown.length) continue;
      const key = markdown.slice(end + 1, close) || label;
      url = definitions.get(referenceKey(key));
      end = close + 1;
    } else {
      url = definitions.get(referenceKey(label));
    }
    if (url === undefined) continue;
    links.push({ start, end, label, url, image });
    if (image) start = end - 1;
    else destinationRanges.push({ start: cursor + 1, end });
  }
  return links;
}

export function findMarkdownImages(markdown: string): MarkdownImage[] {
  return findMarkdownLinks(markdown)
    .filter((link) => link.image)
    .map((link) => ({ ...link, alt: link.label }));
}

function htmlImageUrls(html: string): string[] {
  const urls: string[] = [];
  for (const image of html.matchAll(/<img(?=\s|>)[^>]*>/gi)) {
    const source = image[0].match(
      /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i,
    );
    if (source) urls.push(source[1] ?? source[2] ?? source[3]);
  }
  return urls;
}

export function hasPostImages(
  raw: string | undefined,
  cooked: string,
): boolean {
  const isContentImage = (url: string): boolean =>
    !isEmojiUrl(url) && !isAvatarUrl(url);
  if (raw !== undefined && raw !== '') {
    const prose = protectMarkdownCode(raw.slice(markdownBodyOffset(raw))).text;
    return (
      findMarkdownImages(raw).some((image) => isContentImage(image.url)) ||
      htmlImageUrls(prose).some(isContentImage)
    );
  }
  const html = cooked.replace(/<(pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  return htmlImageUrls(html).some(isContentImage);
}
