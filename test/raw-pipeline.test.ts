// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { PipelineContext } from '../src/types';
import { DEFAULTS } from '../src/config/defaults';
import {
  processRaw,
  resolveUploadShortUrls,
  resolveRelativeLinks,
  transformQuotes,
  transformPolls,
  transformDates,
  transformDetails,
  transformQuotePreviews,
  normalizeObsidianSpacing,
  escapeBracketedLinkLabels,
  rewriteImagePaths,
} from '../src/core/raw-pipeline';

function mockCtx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    origin: 'https://example.com',
    topicId: 12345,
    topicSlug: 'test-topic',
    polls: [],
    cookedHtml: '',
    config: { ...DEFAULTS },
    uploadMap: new Map(),
    ...overrides,
  };
}

describe('resolveUploadShortUrls', () => {
  it('replaces upload:// with mapped URLs', () => {
    const map = new Map([
      ['upload://abc123.png', 'https://example.com/uploads/abc123.png'],
      ['upload://xyz789.jpg', 'https://example.com/uploads/xyz789.jpg'],
    ]);
    const input =
      'Image: ![img](upload://abc123.png) and ![img2](upload://xyz789.jpg)';
    const result = resolveUploadShortUrls(input, map);
    expect(result).toContain('https://example.com/uploads/abc123.png');
    expect(result).toContain('https://example.com/uploads/xyz789.jpg');
    expect(result).not.toContain('upload://');
  });

  it('returns empty for empty input', () => {
    expect(resolveUploadShortUrls('', new Map())).toBe('');
  });
});

describe('resolveRelativeLinks', () => {
  it('resolves /t/slug/123 to full URL', () => {
    const input = '[link](/t/slug/123)';
    const result = resolveRelativeLinks(input, 'https://example.com');
    expect(result).toBe('[link](https://example.com/t/slug/123)');
  });

  it('resolves relative image links', () => {
    const input = '![alt](/uploads/default/image.png)';
    const result = resolveRelativeLinks(input, 'https://example.com');
    expect(result).toBe(
      '![alt](https://example.com/uploads/default/image.png)',
    );
  });

  it('returns empty for empty input', () => {
    expect(resolveRelativeLinks('', 'https://example.com')).toBe('');
  });
});

describe('transformQuotes', () => {
  it('transforms basic quote to callout format', () => {
    const raw = '[quote="alice"]\nHello world\n[/quote]';
    const result = transformQuotes(raw, mockCtx());
    expect(result).toContain('> [!quote] @alice');
    expect(result).toContain('> Hello world');
    expect(result).not.toContain('[quote');
    expect(result).not.toContain('[/quote]');
  });

  it('processes nested quotes recursively', () => {
    const raw =
      '[quote="outer"]\nBefore\n[quote="inner"]\nNested\n[/quote]\nAfter\n[/quote]';
    const result = transformQuotes(raw, mockCtx());
    expect(result).toContain('> [!quote] @outer');
    expect(result).toContain('> [!quote] @inner');
    expect(result).not.toContain('[quote');
  });

  it('transforms repeated identical quotes', () => {
    const quote = '[quote="alice"]\nSame\n[/quote]';
    const result = transformQuotes(`${quote}\n\n${quote}`, mockCtx());

    expect(result.match(/> \[!quote\] @alice/g)?.length).toBe(2);
    expect(result).not.toContain('[quote');
  });
});

describe('transformPolls', () => {
  it('renders poll with JSON data as table', () => {
    const raw = '[poll name=poll type=regular]\n* A\n* B\n[/poll]';
    const ctx = mockCtx({
      polls: [
        {
          id: 1,
          name: 'poll',
          type: 'regular',
          status: 'open',
          public: false,
          results: 'always',
          options: [
            { id: '1', html: 'A', votes: 7 },
            { id: '2', html: 'B', votes: 3 },
          ],
          voters: 10,
          chart_type: 'bar',
        },
      ],
    });
    const result = transformPolls(raw, ctx);
    expect(result).toContain('| 选项 | 得票 | 占比 |');
    expect(result).toContain('| A | 7 | 70% |');
    expect(result).toContain('| B | 3 | 30% |');
    expect(result).toContain('投票人数: 10');
  });

  it('renders poll without JSON data as list', () => {
    const raw = '[poll name=poll type=regular]\n* A\n* B\n[/poll]';
    const result = transformPolls(raw, mockCtx());
    expect(result).toContain('**投票**');
    expect(result).toContain('- A');
    expect(result).toContain('- B');
  });

  it('transforms repeated identical polls', () => {
    const poll = '[poll name=poll type=regular]\n* A\n* B\n[/poll]';
    const result = transformPolls(`${poll}\n${poll}`, mockCtx());

    expect(result.match(/\*\*投票\*\*/g)?.length).toBe(2);
    expect(result).not.toContain('[poll');
  });
});

describe('transformDates', () => {
  it('formats date with time and timezone', () => {
    const raw =
      'Meeting: [date=2026-01-08 time=14:30:00 timezone="Asia/Shanghai"]';
    const result = transformDates(raw);
    expect(result).toContain('2026-01-08');
    expect(result).toContain('14:30');
    expect(result).toContain('(Asia/Shanghai)');
    expect(result).not.toContain('[date=');
  });

  it('returns empty for empty input', () => {
    expect(transformDates('')).toBe('');
  });

  it('transforms repeated identical dates', () => {
    const date = '[date=2026-01-08 time=14:30:00 timezone="Asia/Shanghai"]';
    const result = transformDates(`${date}\n${date}`);

    expect(result.match(/2026-01-08 14:30 \(Asia\/Shanghai\)/g)?.length).toBe(2);
    expect(result).not.toContain('[date=');
  });
});

describe('transformDetails', () => {
  it('transforms details to collapsible callout', () => {
    const raw = '[details="Click me"]\nHidden content\n[/details]';
    const result = transformDetails(raw);
    expect(result).toContain('> [!note]- Click me');
    expect(result).toContain('> Hidden content');
    expect(result).not.toContain('[details');
    expect(result).not.toContain('[/details]');
  });

  it('returns empty for empty input', () => {
    expect(transformDetails('')).toBe('');
  });

  it('transforms repeated identical details blocks', () => {
    const details = '[details="Click me"]\nHidden content\n[/details]';
    const result = transformDetails(`${details}\n\n${details}`);

    expect(result.match(/> \[!note\]- Click me/g)?.length).toBe(2);
    expect(result).not.toContain('[details');
  });

  it('transforms raw HTML details summary blocks', () => {
    const raw =
      '<details><summary>Click me</summary><p>Hidden <strong>content</strong></p></details>';
    const result = transformDetails(raw);

    expect(result).toContain('> [!note]- Click me');
    expect(result).toContain('> Hidden **content**');
    expect(result).not.toContain('<summary>');
  });
});

describe('transformQuotes — block ref for same topic', () => {
  it('uses block ref for same-topic quote', () => {
    const raw = '[quote="alice, post:3, topic:12345"]\nHello\n[/quote]';
    const result = transformQuotes(raw, mockCtx({ topicId: 12345 }));
    expect(result).toContain('[[#^floor-3|#3]]');
    expect(result).not.toContain('https://');
  });

  it('uses URL for different-topic quote', () => {
    const raw = '[quote="alice, post:3, topic:99999"]\nHello\n[/quote]';
    const result = transformQuotes(raw, mockCtx({ topicId: 12345 }));
    expect(result).toContain('[#3](https://example.com/t/topic/99999/3)');
    expect(result).not.toContain('[[#^floor');
  });

  it('uses block ref when topic is omitted (same topic implied)', () => {
    const raw = '[quote="alice, post:5"]\nHello\n[/quote]';
    const result = transformQuotes(raw, mockCtx({ topicId: 12345 }));
    expect(result).toContain('[[#^floor-5|#5]]');
  });
});

describe('normalizeObsidianSpacing', () => {
  it('separates standalone image lines from following text', () => {
    const input = '![image](https://example.com/image.png)\nnext paragraph';
    const result = normalizeObsidianSpacing(input);
    expect(result).toBe(
      '![image](https://example.com/image.png)\n\nnext paragraph',
    );
  });

  it('separates transformed quote blocks from adjacent text', () => {
    const input = 'before\n> [!quote] @alice\n> quoted\nafter';
    const result = normalizeObsidianSpacing(input);
    expect(result).toBe('before\n\n> [!quote] @alice\n> quoted\n\nafter');
  });

  it('does not rewrite fenced code block contents', () => {
    const input =
      '```\n![image](https://example.com/image.png)\nnext line\n```';
    const result = normalizeObsidianSpacing(input);
    expect(result).toBe(input);
  });
});

describe('processRaw spacing', () => {
  it('keeps image and text as separate Obsidian blocks', () => {
    const raw = '![image](https://example.com/image.png)\ntext';
    const result = processRaw(raw, mockCtx());
    expect(result).toBe('![image](https://example.com/image.png)\n\ntext');
  });
});

describe('processRaw oneboxes', () => {
  it('replaces raw site-relative topic links with cooked inline onebox titles', () => {
    const result = processRaw(
      '/t/linked-topic/456',
      mockCtx({
        cookedHtml:
          '<p><a class="inline-onebox" href="/t/linked-topic/456">Linked topic title</a></p>',
      }),
    );

    expect(result).toBe('[Linked topic title](https://example.com/t/linked-topic/456)');
  });

  it('replaces raw site-relative topic links with cooked quote previews', () => {
    const result = processRaw(
      '/t/other-topic/456/7',
      mockCtx({
        cookedHtml: `
          <aside class="quote quote-modified" data-post="7" data-topic="456">
            <div class="title">
              <img alt="bob" class="avatar" src="/user_avatar/example/bob/48/1.png">
              <a href="/t/other-topic/456/7">Other topic title</a>
            </div>
            <blockquote><p>Quoted body</p></blockquote>
          </aside>
        `,
      }),
    );

    expect(result).toContain('> [!quote] Other topic title');
    expect(result).toContain('[#7](https://example.com/t/topic/456/7)');
    expect(result).toContain('> Quoted body');
  });
});

describe('escapeBracketedLinkLabels', () => {
  it('escapes bracketed footnote link labels in raw quote content', () => {
    const raw =
      '[quote="alice, post:18, topic:999"]\nText[[1]](#footnote-164979-1)\n[/quote]';
    const result = processRaw(raw, mockCtx({ topicId: 12345 }));

    expect(result).toContain('Text[\\[1\\]](#footnote-164979-1)');
    expect(result).not.toContain('[[1]](#footnote-164979-1)');
  });

  it('escapes bracketed image link labels without touching Obsidian links', () => {
    const input =
      'See [[image]](https://example.com/image.png) and [[#^floor-1|#1]].';
    const result = escapeBracketedLinkLabels(input);

    expect(result).toBe(
      'See [\\[image\\]](https://example.com/image.png) and [[#^floor-1|#1]].',
    );
  });

  it('does not rewrite fenced code block contents', () => {
    const input = '```\n[[1]](#footnote-1)\n```\n[[1]](#footnote-1)';
    const result = escapeBracketedLinkLabels(input);

    expect(result).toBe('```\n[[1]](#footnote-1)\n```\n[\\[1\\]](#footnote-1)');
  });
});

describe('rewriteImagePaths', () => {
  it('escapes Obsidian image aliases with special characters', () => {
    const result = rewriteImagePaths(
      String.raw`![a\]b|c](https://example.com/image.png)`,
      mockCtx({ config: { ...DEFAULTS, imgMode: 'file' } }),
    );

    expect(result).toBe(String.raw`![[image.png|a\]b&#124;c]]`);
  });
});
