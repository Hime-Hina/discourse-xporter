import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAllPosts,
  fetchTopicPostIds,
  fetchCategoryName,
  fetchTopic,
  fetchBinary,
  HttpError,
} from '../src/core/api';
import { retryDelayMs, sleep } from '../src/utils/timing';
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
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('fetchAllPosts', () => {
  it('fetches missing posts and sorts by post number', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ post_stream: { posts: [mockPost(2, 2)] } }),
      ),
    );

    const posts = await fetchAllPosts(123, [1, 2], [mockPost(1, 1)], {
      ...DEFAULTS,
      batchDelayMin: 0,
      batchDelayMax: 0,
    });

    expect(posts.map((p) => p.id)).toEqual([1, 2]);
  });

  it('throws on batch HTTP failures instead of silently omitting posts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({}, 500)),
    );

    await expect(
      fetchAllPosts(123, [1, 2], [mockPost(1, 1)], {
        ...DEFAULTS,
        batchDelayMin: 0,
        batchDelayMax: 0,
      }),
    ).rejects.toThrow('HTTP 500');
  });

  it('throws when the final stream is incomplete', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ post_stream: { posts: [] } })),
    );

    await expect(
      fetchAllPosts(123, [1, 2], [mockPost(1, 1)], {
        ...DEFAULTS,
        batchDelayMin: 0,
        batchDelayMax: 0,
      }),
    ).rejects.toThrow('missing 1');
  });
});

describe('authoritative visible IDs', () => {
  it('completes a mega stream through the finite post_ids protocol, preserving gaps and deduplicating IDs', async () => {
    const first = mockPost(101, 1);
    const last = mockPost(901, 8);
    const calls = vi.fn(async (url: string) =>
      url.includes('/post_ids.json')
        ? jsonResponse({ post_ids: [407, 901, 901] })
        : jsonResponse({
            post_stream: { posts: [last, mockPost(407, 4), last] },
          }),
    );
    vi.stubGlobal('fetch', calls);
    const ids = await fetchTopicPostIds(
      {
        id: 123,
        post_stream: { posts: [first], isMegaTopic: true, lastId: 901 },
      },
      { origin: 'https://mega.example' },
    );
    const posts = await fetchAllPosts(
      123,
      ids,
      [first],
      { ...DEFAULTS, batchSize: 100, batchDelayMin: 0, batchDelayMax: 0 },
      undefined,
      { origin: 'https://mega.example' },
    );
    expect(posts.map((post) => [post.id, post.post_number])).toEqual([
      [101, 1],
      [407, 4],
      [901, 8],
    ]);
    expect(calls.mock.calls[0][0]).toBe(
      'https://mega.example/t/123/post_ids.json?post_number=1',
    );
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it('rejects an empty or truncated ID result rather than declaring a mega topic complete', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ post_ids: [] })),
    );
    await expect(
      fetchTopicPostIds({
        id: 123,
        post_stream: {
          posts: [mockPost(101, 1)],
          isMegaTopic: true,
          lastId: 901,
        },
      }),
    ).rejects.toThrow('last post is missing');
  });

  it('rejects malformed IDs and unavailable requested posts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ post_ids: [NaN, -1] })),
    );
    await expect(
      fetchTopicPostIds({
        id: 123,
        post_stream: {
          posts: [mockPost(101, 1)],
          isMegaTopic: true,
          lastId: 901,
        },
      }),
    ).rejects.toThrow('Invalid post ID');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ post_stream: { posts: [mockPost(101, 1)] } }),
      ),
    );
    await expect(
      fetchAllPosts(123, [101, 901], [mockPost(101, 1)], DEFAULTS),
    ).rejects.toThrow('missing 1');
  });

  it('validates external topic identity and does not require a mega stream array', async () => {
    const topic = {
      id: 123,
      title: 'Mega',
      category_id: 3,
      user_id: 10,
      details: { created_by: { username: 'Alice' } },
      post_stream: {
        posts: [mockPost(101, 1)],
        isMegaTopic: true,
        lastId: 901,
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(topic)),
    );
    expect(
      (await fetchTopic(123, { origin: 'https://mega.example' })).post_stream
        .isMegaTopic,
    ).toBe(true);
    await expect(fetchTopic(0)).rejects.toThrow('Invalid topic ID');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ ...topic, id: 999 })),
    );
    await expect(fetchTopic(123)).rejects.toThrow('Invalid topic response');
  });
});

describe('target category resolution', () => {
  it('uses target IDs and caches only within the same origin, independent of page breadcrumbs', async () => {
    vi.stubGlobal('document', {
      querySelectorAll: () => [{ textContent: 'Wrong page category' }],
    });
    const calls = vi.fn(async (url: string) =>
      jsonResponse({
        categories: [
          { id: 2, name: url.includes('second.example') ? 'Second site' : 'B' },
          { id: 3, name: 'Child C', parent_category_id: 2 },
        ],
      }),
    );
    vi.stubGlobal('fetch', calls);
    expect(
      await fetchCategoryName(2, { origin: 'https://first.example' }),
    ).toBe('B');
    expect(
      await fetchCategoryName(3, { origin: 'https://first.example' }),
    ).toBe('Child C');
    expect(
      await fetchCategoryName(2, { origin: 'https://second.example' }),
    ).toBe('Second site');
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it('uses an explicit fallback on metadata failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({}, 403)),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      await fetchCategoryName(77, { origin: 'https://failed.example' }),
    ).toBe('category-77');
  });
});

describe('bounded reads and cancellation', () => {
  it('retries Retry-After and network errors predictably, but never retries authentication failures', async () => {
    vi.useFakeTimers();
    const calls = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('', { status: 429, headers: { 'Retry-After': '2' } }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([7])));
    vi.stubGlobal('fetch', calls);
    const bytes = fetchBinary('https://cdn.example/image.png');
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await bytes).toEqual(new Uint8Array([7]));
    expect(calls).toHaveBeenCalledTimes(2);
    calls
      .mockReset()
      .mockRejectedValueOnce(new TypeError('Network'))
      .mockResolvedValueOnce(new Response(new Uint8Array([8])));
    const network = fetchBinary('https://cdn.example/image.png');
    await vi.advanceTimersByTimeAsync(500);
    expect(await network).toEqual(new Uint8Array([8]));
    for (const status of [401, 403]) {
      calls.mockReset().mockResolvedValue(new Response('', { status }));
      await expect(
        fetchBinary('https://cdn.example/image.png'),
      ).rejects.toMatchObject({ status });
      expect(calls).toHaveBeenCalledTimes(1);
    }
  });

  it('terminates a never-settling fetch and a never-settling body at the configured timeout', async () => {
    vi.useFakeTimers();
    const calls = vi.fn(async () => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', calls);
    const timeout = expect(
      fetchBinary('https://cdn.example/a.png', 100),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(700);
    await timeout;
    expect(calls).toHaveBeenCalledTimes(2);
    calls
      .mockReset()
      .mockImplementation(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull: () => new Promise<void>(() => {}),
            }),
          ),
      );
    const bodyTimeout = expect(
      fetchBinary('https://cdn.example/b.png', 100),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(700);
    await bodyTimeout;
  });

  it('aborts in-flight reads and backoff without scheduling more requests', async () => {
    vi.useFakeTimers();
    const calls = vi.fn(async () => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', calls);
    const controller = new AbortController();
    const cancelled = expect(
      fetchBinary('https://cdn.example/a.png', 60_000, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await cancelled;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toHaveBeenCalledTimes(1);
    const sleeping = new AbortController();
    const sleepCancelled = expect(
      sleep(10_000, sleeping.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    sleeping.abort();
    await sleepCancelled;
  });

  it('parses both Retry-After forms and bounds excessively large values', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-11T00:00:00Z'));
    expect(retryDelayMs('Wed, 11 Nov 2026 00:00:03 GMT')).toBe(3000);
    expect(retryDelayMs('999999')).toBe(60_000);
    expect(retryDelayMs('invalid', 2)).toBe(1000);
    expect(new HttpError(503).status).toBe(503);
  });
});
