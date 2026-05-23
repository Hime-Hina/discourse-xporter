import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAllPosts } from '../src/core/api';
import { DEFAULTS } from '../src/config/defaults';
import type { DiscoursePost } from '../src/types';

function mockPost(id: number, postNumber: number): DiscoursePost {
  return {
    id,
    post_number: postNumber,
    post_type: 1,
    username: 'alice',
    name: 'Alice',
    avatar_template: '/avatar/{size}.png',
    user_id: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    cooked: '<p>Hello</p>',
    raw: 'Hello',
    reply_count: 0,
    reply_to_post_number: null,
    quote_count: 0,
    reads: 0,
    score: 0,
    topic_id: 123,
    topic_slug: 'topic',
    display_username: 'alice',
    version: 1,
    trust_level: 1,
    moderator: false,
    admin: false,
    staff: false,
    hidden: false,
    deleted_at: null,
    wiki: false,
    user_title: null,
    actions_summary: [],
    post_url: `/t/topic/123/${postNumber}`,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchAllPosts', () => {
  it('fetches missing posts and sorts by post number', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ post_stream: { posts: [mockPost(2, 2)] } }),
      ),
    );

    const posts = await fetchAllPosts(
      123,
      [1, 2],
      [mockPost(1, 1)],
      { ...DEFAULTS, batchDelayMin: 0, batchDelayMax: 0 },
    );

    expect(posts.map((p) => p.id)).toEqual([1, 2]);
  });

  it('throws on batch HTTP failures instead of silently omitting posts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)));

    await expect(
      fetchAllPosts(
        123,
        [1, 2],
        [mockPost(1, 1)],
        { ...DEFAULTS, batchDelayMin: 0, batchDelayMax: 0 },
      ),
    ).rejects.toThrow('HTTP 500');
  });

  it('throws when the final stream is incomplete', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ post_stream: { posts: [] } })),
    );

    await expect(
      fetchAllPosts(
        123,
        [1, 2],
        [mockPost(1, 1)],
        { ...DEFAULTS, batchDelayMin: 0, batchDelayMax: 0 },
      ),
    ).rejects.toThrow('missing 1');
  });
});
