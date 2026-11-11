import {
  markdownCodeRanges,
  type MarkdownCodeRange,
} from '../utils/markdown-code';
import { findMarkdownLinks } from '../utils/markdown-links';
import { markdownLabelToObsidianAlias } from '../utils/obsidian';
import { topicUrl } from '../utils/url';

export interface ExportedTopicNote {
  source: string;
  topicId: number;
  path: string;
  markdown: string;
}

interface TopicReference {
  origin: string;
  topicId: number;
  postNumber?: number;
}

export interface TopicLinkRewrite {
  markdown: string;
  ambiguousTargets: string[];
}

function bodyOffset(markdown: string): number {
  const opening = markdown.match(/^\uFEFF?---[ \t]*\r?\n/);
  if (!opening) return 0;
  const ending = /^---[ \t]*(?:\r?\n|$)/gm;
  ending.lastIndex = opening[0].length;
  const closing = ending.exec(markdown);
  return closing ? closing.index + closing[0].length : markdown.length;
}

function excludedRanges(markdown: string): MarkdownCodeRange[] {
  return [
    ...markdownCodeRanges(markdown),
    ...[...markdown.matchAll(/<!--[\s\S]*?(?:-->|$)/g)].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    })),
  ];
}

function within(offset: number, ranges: readonly MarkdownCodeRange[]): boolean {
  return ranges.some((range) => offset >= range.start && offset < range.end);
}

/** A duplicate ID cannot identify one block reliably. Frontmatter is never an anchor source. */
export function actualFloorNumbers(markdown: string): ReadonlySet<number> {
  const body = markdown.slice(bodyOffset(markdown));
  const excluded = excludedRanges(body);
  const counts = new Map<number, number>();
  for (const match of body.matchAll(
    /^(.*?)(?:[ \t]|^)\^floor-([1-9]\d*)[ \t]*\r?$/gm,
  )) {
    const at = match.index + match[0].lastIndexOf('^floor-');
    if (within(at, excluded) || /^\s*>/.test(match[0])) continue;
    const postNumber = Number(match[2]);
    if (!Number.isSafeInteger(postNumber)) continue;
    counts.set(postNumber, (counts.get(postNumber) ?? 0) + 1);
  }
  return new Set(
    [...counts].filter(([, count]) => count === 1).map(([number]) => number),
  );
}

function parseTopicReference(
  rawUrl: string,
  baseOrigin?: string,
): TopicReference | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl, baseOrigin);
  } catch {
    return undefined;
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    return undefined;
  if ([...url.searchParams.keys()].some((key) => key !== 'u')) return undefined;
  const segments = url.pathname.split('/').filter(Boolean);
  if (!['t', 'nested'].includes(segments[0])) return undefined;
  const topicAt = /^\d+$/.test(segments[1] ?? '') ? 1 : 2;
  if (segments.length < topicAt + 1 || segments.length > topicAt + 2)
    return undefined;
  const id = segments[topicAt];
  const floor = segments[topicAt + 1];
  if (
    !/^[1-9]\d*$/.test(id) ||
    (floor !== undefined && !/^[1-9]\d*$/.test(floor))
  )
    return undefined;
  const topicId = Number(id);
  let postNumber = floor === undefined ? undefined : Number(floor);
  if (url.hash) {
    const hashFloor = url.hash.match(/^#post[_-]([1-9]\d*)$/)?.[1];
    if (
      !hashFloor ||
      (postNumber !== undefined && postNumber !== Number(hashFloor))
    )
      return undefined;
    postNumber = Number(hashFloor);
  }
  if (
    !Number.isSafeInteger(topicId) ||
    (postNumber !== undefined && !Number.isSafeInteger(postNumber))
  )
    return undefined;
  return { origin: url.origin, topicId, postNumber };
}

function noteReference(note: ExportedTopicNote): TopicReference | undefined {
  const reference = parseTopicReference(note.source);
  return reference?.topicId === note.topicId ? reference : undefined;
}

function identity(reference: TopicReference): string {
  return `${reference.origin}/t/topic/${reference.topicId}`;
}

function relativeNotePath(fromPath: string, toPath: string): string {
  const from = fromPath.split('/').filter(Boolean).slice(0, -1);
  const to = toPath.split('/').filter(Boolean);
  let shared = 0;
  while (shared < from.length && from[shared] === to[shared]) shared++;
  const encoded = to
    .slice(shared)
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    );
  return '../'.repeat(from.length - shared) + encoded.join('/');
}

/** Resolve only known exports. The caller supplies the operation's current vault snapshot. */
export function rewriteTopicLinks(
  note: ExportedTopicNote,
  targets: readonly ExportedTopicNote[],
): TopicLinkRewrite {
  const current = noteReference(note);
  if (!current) return { markdown: note.markdown, ambiguousTargets: [] };
  const catalog = new Map<string, Map<string, ExportedTopicNote>>();
  for (const target of [...targets, note]) {
    const reference = noteReference(target);
    if (!reference) continue;
    const key = identity(reference);
    const byPath = catalog.get(key) ?? new Map<string, ExportedTopicNote>();
    byPath.set(target.path, target);
    catalog.set(key, byPath);
  }
  const anchors = new Map<ExportedTopicNote, ReadonlySet<number>>();
  const floors = (target: ExportedTopicNote): ReadonlySet<number> => {
    let available = anchors.get(target);
    if (!available) {
      available = actualFloorNumbers(target.markdown);
      anchors.set(target, available);
    }
    return available;
  };
  const ambiguousTargets = new Set<string>();
  const resolve = (rawUrl: string, label: string): string | undefined => {
    const reference = parseTopicReference(rawUrl, current.origin);
    if (!reference) return undefined;
    const key = identity(reference);
    if (
      key === identity(current) &&
      reference.postNumber !== undefined &&
      floors(note).has(reference.postNumber)
    ) {
      return `[[#^floor-${reference.postNumber}|${markdownLabelToObsidianAlias(label)}]]`;
    }
    const matches = [...(catalog.get(key)?.values() ?? [])];
    if (matches.length > 1) {
      ambiguousTargets.add(key);
      return undefined;
    }
    const target = matches[0];
    if (!target || /[\0\r\n]/.test(target.path) || !target.path)
      return undefined;
    if (
      reference.postNumber !== undefined &&
      !floors(target).has(reference.postNumber)
    )
      return undefined;
    if (/[\[\]#|]/.test(target.path)) {
      const destination =
        relativeNotePath(note.path, target.path) +
        (reference.postNumber === undefined
          ? ''
          : `#^floor-${reference.postNumber}`);
      return `[${label}](<${destination}>)`;
    }
    const destination =
      target.path.replace(/\.md$/i, '') +
      (reference.postNumber === undefined
        ? ''
        : `#^floor-${reference.postNumber}`);
    return `[[${destination}|${markdownLabelToObsidianAlias(label)}]]`;
  };

  const offset = bodyOffset(note.markdown);
  const body = note.markdown.slice(offset);
  const excluded = excludedRanges(body);
  const edits: { start: number; end: number; replacement: string }[] = [];
  const wikiRanges: MarkdownCodeRange[] = [];
  for (const match of body.matchAll(/!?\[\[(?:\\.|[^\]\\])*\]\]/g)) {
    const start = match.index;
    const end = start + match[0].length;
    wikiRanges.push({ start, end });
    if (within(start, excluded) || match[0].startsWith('!')) continue;
    const local = match[0].match(
      /^\[\[#\^floor-([1-9]\d*)(?:\|([\s\S]*))?\]\]$/,
    );
    if (local && !floors(note).has(Number(local[1]))) {
      edits.push({
        start,
        end,
        replacement: `[${local[2] ?? `#${local[1]}`}](${topicUrl(current.origin, current.topicId, Number(local[1]))})`,
      });
    }
  }
  const htmlRanges = [...body.matchAll(/<[^>\n]*>/g)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  const links = findMarkdownLinks(body);
  for (const link of links) {
    if (
      link.image ||
      within(link.start, [...excluded, ...wikiRanges, ...htmlRanges])
    )
      continue;
    const replacement = resolve(link.url, link.label);
    if (replacement)
      edits.push({ start: link.start, end: link.end, replacement });
  }
  const definitions = [
    ...body.matchAll(/^ {0,3}\[[^\n]*\]:[^\n]*(?:\n|$)/gm),
  ].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  const bareExcluded = [...excluded, ...wikiRanges, ...links, ...definitions];
  for (const match of body.matchAll(
    /<((?:https?:\/\/|\/(?:t|nested)\/)[^\s<>]+)>|(?<![\w/@="'\\])(?:https?:\/\/|\/(?:t|nested)\/)[^\s<>\[\]"']+/g,
  )) {
    const start = match.index;
    if (within(start, bareExcluded) || (!match[1] && within(start, htmlRanges)))
      continue;
    let url = match[1] ?? match[0];
    if (!match[1]) {
      url = url.replace(/[.,;:!?]+$/, '');
      while (
        url.endsWith(')') &&
        (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)
      )
        url = url.slice(0, -1);
    }
    const replacement = resolve(url, url);
    if (replacement)
      edits.push({
        start,
        end: start + (match[1] ? match[0].length : url.length),
        replacement,
      });
  }
  let rewritten = body;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    rewritten =
      rewritten.slice(0, edit.start) +
      edit.replacement +
      rewritten.slice(edit.end);
  }
  return {
    markdown: note.markdown.slice(0, offset) + rewritten,
    ambiguousTargets: [...ambiguousTargets].sort(),
  };
}

/** Only selected existing exports become writes; unchanged notes require no PUT. */
export function refreshTopicNoteLinks(
  selectedNotes: readonly ExportedTopicNote[],
  targets: readonly ExportedTopicNote[],
): {
  updates: { path: string; markdown: string }[];
  ambiguousTargets: string[];
} {
  const updates: { path: string; markdown: string }[] = [];
  const ambiguousTargets = new Set<string>();
  const catalog = [...targets, ...selectedNotes];
  for (const note of selectedNotes) {
    const rewritten = rewriteTopicLinks(note, catalog);
    for (const target of rewritten.ambiguousTargets)
      ambiguousTargets.add(target);
    if (rewritten.markdown !== note.markdown)
      updates.push({ path: note.path, markdown: rewritten.markdown });
  }
  return { updates, ambiguousTargets: [...ambiguousTargets].sort() };
}
