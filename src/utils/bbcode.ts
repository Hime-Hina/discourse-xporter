// ---------------------------------------------------------------------------
// BBCode parser for Discourse-specific tags
// ---------------------------------------------------------------------------

export interface QuoteParams {
  username: string;
  post: number | null;
  topic: number | null;
  full: boolean;
}

export interface PollParams {
  name: string;
  type: string;
  results: string;
  chartType: string;
  options: string[];
}

export interface DateParams {
  date: string;
  time: string | null;
  timezone: string | null;
  format: string | null;
}

export interface DetailsParams {
  title: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find all outermost occurrences of a paired BBCode tag using bracket counting.
 * Returns `{ open, content, fullMatch, startIndex }` for each outermost pair.
 */
export interface SourceRange {
  startIndex: number;
  endIndex: number;
}

function findOutermostPairs(
  raw: string,
  tagName: string,
): ({ open: string; content: string; fullMatch: string } & SourceRange)[] {
  const pairs: ({
    open: string;
    content: string;
    fullMatch: string;
  } & SourceRange)[] = [];
  const tags = new RegExp(
    `\\[${tagName}(?:[=\\s][^\\]]*)?\\]|\\[/${tagName}\\]`,
    'gi',
  );
  let outer: { start: number; contentStart: number; open: string } | undefined;
  let depth = 0;
  let tag: RegExpExecArray | null;
  while ((tag = tags.exec(raw))) {
    if (tag[0][1] !== '/') {
      if (depth === 0)
        outer = {
          start: tag.index,
          contentStart: tags.lastIndex,
          open: tag[0],
        };
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0 && outer) {
        pairs.push({
          open: outer.open,
          content: raw.slice(outer.contentStart, tag.index),
          fullMatch: raw.slice(outer.start, tags.lastIndex),
          startIndex: outer.start,
          endIndex: tags.lastIndex,
        });
        outer = undefined;
      }
    }
  }
  return pairs;
}

/**
 * Parse `key=value` or `key="value"` pairs from a string.
 */
function parseKeyValuePairs(str: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  const re = /(\w+)=(?:"([^"]*)"|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    pairs[m[1]] = m[2] ?? m[3];
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse outermost `[quote]...[/quote]` tags from raw Markdown.
 *
 * Only the outermost level is returned; nested quotes remain inside `content`
 * for the caller to process recursively.
 *
 * @example
 * ```
 * [quote="alice, post:3, topic:12345, full:true"]
 * Hello world
 * [/quote]
 * ```
 */
export function parseQuoteTag(
  raw: string,
): ({
  params: QuoteParams;
  content: string;
  fullMatch: string;
} & SourceRange)[] {
  const pairs = findOutermostPairs(raw, 'quote');

  return pairs.map(({ open, content, fullMatch, startIndex, endIndex }) => {
    // Extract the attribute string inside [quote="..."]
    const attrMatch = open.match(/\[quote="([^"]*)"\s*\]/i);
    const attrStr = attrMatch?.[1] ?? '';

    // Format: "username, post:N, topic:T, full:true"
    const parts = attrStr.split(',').map((s) => s.trim());
    const username = parts[0] ?? '';

    let post: number | null = null;
    let topic: number | null = null;
    let full = false;

    for (let i = 1; i < parts.length; i++) {
      const kv = parts[i].split(':');
      if (kv.length < 2) continue;
      const key = kv[0].trim().toLowerCase();
      const val = kv.slice(1).join(':').trim();
      if (key === 'post') post = parseInt(val, 10) || null;
      else if (key === 'topic') topic = parseInt(val, 10) || null;
      else if (key === 'full') full = val === 'true';
    }

    return {
      params: { username, post, topic, full },
      content,
      fullMatch,
      startIndex,
      endIndex,
    };
  });
}

/**
 * Parse `[poll ...]...[/poll]` tags from raw Markdown.
 *
 * Poll options are lines matching `* option text` inside the tag body.
 */
export function parsePollTag(
  raw: string,
): ({
  params: PollParams;
  content: string;
  fullMatch: string;
} & SourceRange)[] {
  const pairs = findOutermostPairs(raw, 'poll');

  return pairs.map(({ open, content, fullMatch, startIndex, endIndex }) => {
    // Everything between "[poll" and the closing "]"
    const inner = open.slice(5, -1).trim(); // strip "[poll" and "]"
    const kv = parseKeyValuePairs(inner);

    const options = content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('* '))
      .map((l) => l.slice(2).trim());

    return {
      params: {
        name: kv['name'] ?? 'poll',
        type: kv['type'] ?? 'regular',
        results: kv['results'] ?? 'always',
        chartType: kv['chartType'] ?? 'bar',
        options,
      },
      content,
      fullMatch,
      startIndex,
      endIndex,
    };
  });
}

/**
 * Parse self-closing `[date=... ...]` tags from raw Markdown.
 *
 * These tags have no closing counterpart — the entire tag is contained
 * within a single `[...]` bracket pair.
 *
 * @example
 * ```
 * [date=2026-01-08 time=14:30:00 timezone="Asia/Shanghai" format="YYYY-MM-DD HH:mm"]
 * ```
 */
export function parseDateTag(
  raw: string,
): ({ params: DateParams; fullMatch: string } & SourceRange)[] {
  const re = /\[date=[^\]]+\]/gi;
  const results: ({ params: DateParams; fullMatch: string } & SourceRange)[] =
    [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(raw)) !== null) {
    const fullMatch = m[0];
    const inner = fullMatch.slice(1, -1); // strip "[" and "]"
    const kv = parseKeyValuePairs(inner);

    results.push({
      params: {
        date: kv['date'] ?? '',
        time: kv['time'] ?? null,
        timezone: kv['timezone'] ?? null,
        format: kv['format'] ?? null,
      },
      fullMatch,
      startIndex: m.index,
      endIndex: re.lastIndex,
    });
  }

  return results;
}

/**
 * Parse outermost `[details="title"]...[/details]` tags from raw Markdown.
 *
 * Only the outermost level is returned; nested details remain inside `content`
 * for the caller to process recursively.
 */
export function parseDetailsTag(
  raw: string,
): ({ params: DetailsParams; fullMatch: string } & SourceRange)[] {
  const pairs = findOutermostPairs(raw, 'details');

  return pairs.map(({ open, content, fullMatch, startIndex, endIndex }) => {
    // [details="title"] or [details=title]
    const titleMatch = open.match(/\[details=(?:"([^"]*)"|(\S+?))\s*\]/i);
    const title = titleMatch?.[1] ?? titleMatch?.[2] ?? '';

    return {
      params: { title, content },
      fullMatch,
      startIndex,
      endIndex,
    };
  });
}
