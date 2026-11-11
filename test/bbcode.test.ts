import { describe, it, expect } from 'vitest';
import {
  parseQuoteTag,
  parsePollTag,
  parseDateTag,
  parseDetailsTag,
} from '../src/utils/bbcode';

describe('parseQuoteTag', () => {
  it('parses a simple quote', () => {
    const raw = '[quote="alice"]\nHello world\n[/quote]';
    const results = parseQuoteTag(raw);
    expect(results).toHaveLength(1);
    expect(results[0].params.username).toBe('alice');
    expect(results[0].params.post).toBeNull();
    expect(results[0].params.topic).toBeNull();
    expect(results[0].params.full).toBe(false);
    expect(results[0].content).toContain('Hello world');
  });

  it('parses a quote with all params (post, topic, full)', () => {
    const raw =
      '[quote="bob, post:3, topic:12345, full:true"]\nSome content\n[/quote]';
    const results = parseQuoteTag(raw);
    expect(results).toHaveLength(1);
    expect(results[0].params.username).toBe('bob');
    expect(results[0].params.post).toBe(3);
    expect(results[0].params.topic).toBe(12345);
    expect(results[0].params.full).toBe(true);
  });

  it('returns only outermost quotes when nested', () => {
    const raw =
      '[quote="outer"]\nBefore\n[quote="inner"]\nNested\n[/quote]\nAfter\n[/quote]';
    const results = parseQuoteTag(raw);
    expect(results).toHaveLength(1);
    expect(results[0].params.username).toBe('outer');
    expect(results[0].content).toContain('[quote="inner"]');
    expect(results[0].content).toContain('Nested');
  });

  it('returns empty array when no quotes', () => {
    const results = parseQuoteTag('Just some plain text');
    expect(results).toEqual([]);
  });
});

describe('parsePollTag', () => {
  it('parses a regular poll with options', () => {
    const raw = [
      '[poll type=regular results=always chartType=bar]',
      '* Option A',
      '* Option B',
      '* Option C',
      '[/poll]',
    ].join('\n');
    const results = parsePollTag(raw);
    expect(results).toHaveLength(1);
    expect(results[0].params.type).toBe('regular');
    expect(results[0].params.results).toBe('always');
    expect(results[0].params.options).toEqual([
      'Option A',
      'Option B',
      'Option C',
    ]);
  });

  it('parses a poll with custom name', () => {
    const raw = [
      '[poll name=my_poll type=multiple]',
      '* Yes',
      '* No',
      '[/poll]',
    ].join('\n');
    const results = parsePollTag(raw);
    expect(results).toHaveLength(1);
    expect(results[0].params.name).toBe('my_poll');
    expect(results[0].params.type).toBe('multiple');
  });

  it('handles poll with no options', () => {
    const raw = '[poll type=regular]\n[/poll]';
    const results = parsePollTag(raw);
    expect(results).toHaveLength(1);
    expect(results[0].params.options).toEqual([]);
  });
});

describe('parseDateTag', () => {
  it('parses a full date with time, timezone, and format', () => {
    const raw =
      '[date=2026-01-08 time=14:30:00 timezone="Asia/Shanghai" format="YYYY-MM-DD HH:mm"]';
    const results = parseDateTag(raw);
    expect(results).toHaveLength(1);
    expect(results[0].params.date).toBe('2026-01-08');
    expect(results[0].params.time).toBe('14:30:00');
    expect(results[0].params.timezone).toBe('Asia/Shanghai');
    expect(results[0].params.format).toBe('YYYY-MM-DD HH:mm');
  });

  it('parses date only', () => {
    const raw = '[date=2026-06-15]';
    const results = parseDateTag(raw);
    expect(results).toHaveLength(1);
    expect(results[0].params.date).toBe('2026-06-15');
    expect(results[0].params.time).toBeNull();
    expect(results[0].params.timezone).toBeNull();
    expect(results[0].params.format).toBeNull();
  });

  it('parses multiple dates in text', () => {
    const raw =
      'Start: [date=2026-01-01 time=09:00:00] End: [date=2026-01-02 time=18:00:00]';
    const results = parseDateTag(raw);
    expect(results).toHaveLength(2);
    expect(results[0].params.date).toBe('2026-01-01');
    expect(results[1].params.date).toBe('2026-01-02');
  });
});

describe('parseDetailsTag', () => {
  it('parses simple details', () => {
    const raw = '[details="Click me"]\nHidden content\n[/details]';
    const results = parseDetailsTag(raw);
    expect(results).toHaveLength(1);
    expect(results[0].params.title).toBe('Click me');
    expect(results[0].params.content).toContain('Hidden content');
  });

  it('returns only outermost when nested', () => {
    const raw =
      '[details="Outer"]\nBefore\n[details="Inner"]\nNested\n[/details]\nAfter\n[/details]';
    const results = parseDetailsTag(raw);
    expect(results).toHaveLength(1);
    expect(results[0].params.title).toBe('Outer');
    expect(results[0].params.content).toContain('[details="Inner"]');
  });

  it('parses details without quotes on title', () => {
    const raw = '[details=Summary]\nContent here\n[/details]';
    const results = parseDetailsTag(raw);
    expect(results).toHaveLength(1);
    expect(results[0].params.title).toBe('Summary');
    expect(results[0].params.content).toContain('Content here');
  });
});

describe('paired tag boundaries', () => {
  it('matches no-attribute tags without swallowing their content', () => {
    expect(parseQuoteTag('[quote]body[/quote]')).toEqual([
      {
        params: { username: '', post: null, topic: null, full: false },
        content: 'body',
        fullMatch: '[quote]body[/quote]',
        startIndex: 0,
        endIndex: 19,
      },
    ]);
    expect(parsePollTag('[poll]\n* A\n* B\n[/poll]')[0].params.options).toEqual(
      ['A', 'B'],
    );
    expect(parseQuoteTag('[quote]a[quoteXYZ]b[/quote]')[0].content).toBe(
      'a[quoteXYZ]b',
    );
    expect(parseQuoteTag('[quote]unclosed')).toEqual([]);
  });
});
