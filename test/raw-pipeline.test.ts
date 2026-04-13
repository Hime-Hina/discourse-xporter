import { describe, it, expect } from 'vitest';
import type { PipelineContext } from '../src/types';
import { DEFAULTS } from '../src/config/defaults';
import {
  resolveUploadShortUrls,
  resolveRelativeLinks,
  transformQuotes,
  transformPolls,
  transformDates,
  transformDetails,
  transformQuotePreviews,
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
    const input = 'Image: ![img](upload://abc123.png) and ![img2](upload://xyz789.jpg)';
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
    expect(result).toBe('![alt](https://example.com/uploads/default/image.png)');
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
});

describe('transformDates', () => {
  it('formats date with time and timezone', () => {
    const raw = 'Meeting: [date=2026-01-08 time=14:30:00 timezone="Asia/Shanghai"]';
    const result = transformDates(raw);
    expect(result).toContain('2026-01-08');
    expect(result).toContain('14:30');
    expect(result).toContain('(Asia/Shanghai)');
    expect(result).not.toContain('[date=');
  });

  it('returns empty for empty input', () => {
    expect(transformDates('')).toBe('');
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
