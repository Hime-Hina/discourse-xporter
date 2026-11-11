import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processRaw } from '../src/core/raw-pipeline';
import { cookedToMarkdown } from '../src/core/cooked-fallback';
import { postToMarkdown } from '../src/core/post-content';

vi.mock('../src/core/raw-pipeline', () => ({ processRaw: vi.fn() }));
vi.mock('../src/core/cooked-fallback', () => ({ cookedToMarkdown: vi.fn() }));

const post = {
  id: 100,
  post_number: 5,
  raw: 'raw',
  cooked: '<p>cooked</p>',
  polls: [],
};
const context = {
  origin: 'https://example.com',
  topicId: 9,
  uploadMap: new Map<string, string>(),
};

beforeEach(() => vi.resetAllMocks());

describe('post body conversion contract', () => {
  it('prefers raw and derives the cooked/poll context from the post once', () => {
    vi.mocked(processRaw).mockReturnValue('raw markdown');
    expect(postToMarkdown(post, context)).toBe('raw markdown');
    expect(processRaw).toHaveBeenCalledWith(post.raw, {
      ...context,
      cookedHtml: post.cooked,
      polls: post.polls,
    });
    expect(cookedToMarkdown).not.toHaveBeenCalled();
  });

  it('converts cooked once when raw is absent', () => {
    vi.mocked(cookedToMarkdown).mockReturnValue('cooked markdown');
    expect(postToMarkdown({ ...post, raw: undefined }, context)).toBe(
      'cooked markdown',
    );
    expect(processRaw).not.toHaveBeenCalled();
    expect(cookedToMarkdown).toHaveBeenCalledExactlyOnceWith(
      post.cooked,
      context,
    );
  });

  it('reports the source identity and falls back once after a raw failure', () => {
    const diagnostic = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    vi.mocked(processRaw).mockImplementation(() => {
      throw new Error('raw failed');
    });
    vi.mocked(cookedToMarkdown).mockReturnValue('fallback');
    expect(postToMarkdown(post, context)).toBe('fallback');
    expect(diagnostic).toHaveBeenCalledExactlyOnceWith(
      '[DXP] Raw conversion failed; using cooked fallback',
      { topicId: 9, postNumber: 5, postId: 100 },
    );
    expect(cookedToMarkdown).toHaveBeenCalledTimes(1);
    diagnostic.mockRestore();
  });

  it('does not retry a failed cooked conversion', () => {
    vi.mocked(cookedToMarkdown).mockImplementation(() => {
      throw new Error('cooked failed');
    });
    expect(() => postToMarkdown({ ...post, raw: undefined }, context)).toThrow(
      'Cooked conversion failed for topic 9, post #5',
    );
    expect(cookedToMarkdown).toHaveBeenCalledTimes(1);
  });
});
