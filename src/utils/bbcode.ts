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
function findOutermostPairs(
  raw: string,
  tagName: string,
): { open: string; content: string; fullMatch: string; startIndex: number }[] {
  const results: {
    open: string;
    content: string;
    fullMatch: string;
    startIndex: number;
  }[] = [];
  const openRe = new RegExp(
    `\\[${tagName}[=\\s\\]][^\\]]*\\]|\\[${tagName}\\]`,
    'gi',
  );
  const closeTag = `[/${tagName}]`;
  const closeLower = closeTag.toLowerCase();

  let searchStart = 0;

  while (searchStart < raw.length) {
    // Find next opening tag starting from searchStart
    openRe.lastIndex = searchStart;
    const openMatch = openRe.exec(raw);
    if (!openMatch) break;

    const openTag = openMatch[0];
    const outerStart = openMatch.index;
    const contentStart = outerStart + openTag.length;

    // Bracket-counting: depth starts at 1 (we consumed the opening tag)
    let depth = 1;
    let cursor = contentStart;
    const tagNameLower = tagName.toLowerCase();

    while (depth > 0 && cursor < raw.length) {
      const nextOpen = raw.toLowerCase().indexOf(`[${tagNameLower}`, cursor);
      const nextClose = raw.toLowerCase().indexOf(closeLower, cursor);

      if (nextClose === -1) break; // malformed — no matching close

      if (nextOpen !== -1 && nextOpen < nextClose) {
        // Verify it's actually a full opening tag (ends with ']')
        const bracketEnd = raw.indexOf(']', nextOpen);
        if (bracketEnd !== -1 && bracketEnd <= nextClose) {
          depth++;
          cursor = bracketEnd + 1;
        } else {
          // Not a real tag, skip past it
          cursor = nextOpen + 1;
        }
      } else {
        depth--;
        if (depth === 0) {
          const content = raw.slice(contentStart, nextClose);
          const fullMatch = raw.slice(outerStart, nextClose + closeTag.length);
          results.push({
            open: openTag,
            content,
            fullMatch,
            startIndex: outerStart,
          });
          searchStart = nextClose + closeTag.length;
        } else {
          cursor = nextClose + closeTag.length;
        }
      }
    }

    // If we never closed, skip past this opening tag
    if (depth !== 0) {
      searchStart = contentStart;
    }
  }

  return results;
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
): { params: QuoteParams; content: string; fullMatch: string }[] {
  const pairs = findOutermostPairs(raw, 'quote');

  return pairs.map(({ open, content, fullMatch }) => {
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
): { params: PollParams; content: string; fullMatch: string }[] {
  const pairs = findOutermostPairs(raw, 'poll');

  return pairs.map(({ open, content, fullMatch }) => {
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
): { params: DateParams; fullMatch: string }[] {
  const re = /\[date=[^\]]+\]/gi;
  const results: { params: DateParams; fullMatch: string }[] = [];
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
): { params: DetailsParams; fullMatch: string }[] {
  const pairs = findOutermostPairs(raw, 'details');

  return pairs.map(({ open, content, fullMatch }) => {
    // [details="title"] or [details=title]
    const titleMatch = open.match(/\[details=(?:"([^"]*)"|(\S+?))\s*\]/i);
    const title = titleMatch?.[1] ?? titleMatch?.[2] ?? '';

    return {
      params: { title, content },
      fullMatch,
    };
  });
}
