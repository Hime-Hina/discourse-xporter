// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTopicExport } from '../src/core/topic-export';
import {
  fetchAllPosts,
  fetchCategoryName,
  fetchTopic,
  fetchTopicPostIds,
  resolveUploadUrls,
} from '../src/core/api';
import { DEFAULTS } from '../src/config/defaults';
import { FORMAT_VERSION } from '../src/config/format-version';
import type { DiscoursePost, DiscourseTopic, FilterConfig } from '../src/types';

vi.mock('../src/core/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/core/api')>()),
  fetchTopic: vi.fn(),
  fetchTopicPostIds: vi.fn(),
  fetchAllPosts: vi.fn(),
  fetchCategoryName: vi.fn(),
  resolveUploadUrls: vi.fn(),
}));

function mockPost(overrides: Partial<DiscoursePost> = {}): DiscoursePost {
  const postNumber = overrides.post_number ?? 1;
  return {
    id: postNumber,
    post_number: postNumber,
    post_type: 1,
    username: postNumber === 1 ? 'alice' : 'bob',
    name: postNumber === 1 ? 'Alice' : 'Bob',
    avatar_template: '/user_avatar/example.com/user/{size}/1.png',
    user_id: postNumber === 1 ? 10 : 20,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    cooked: '<p>Hello</p>',
    raw: postNumber === 1 ? 'Question' : 'Accepted answer body',
    reply_count: 0,
    reply_to_post_number: null,
    quote_count: 0,
    reads: 1,
    score: 0,
    topic_id: 123,
    topic_slug: 'topic',
    display_username: postNumber === 1 ? 'alice' : 'bob',
    version: 1,
    trust_level: 1,
    moderator: false,
    admin: false,
    staff: false,
    hidden: false,
    deleted_at: null,
    wiki: false,
    user_title: null,
    post_url: `/t/topic/123/${postNumber}`,
    ...overrides,
  };
}

function mockTopic(overrides: Partial<DiscourseTopic> = {}): DiscourseTopic {
  const posts = [mockPost({ post_number: 1 }), mockPost({ post_number: 2 })];
  return {
    id: 123,
    title: 'Solved topic',
    fancy_title: 'Solved topic',
    slug: 'topic',
    category_id: 1,
    tags: [],
    posts_count: 2,
    created_at: '2026-01-01T00:00:00.000Z',
    views: 10,
    reply_count: 1,
    like_count: 0,
    word_count: 100,
    user_id: 10,
    highest_post_number: 2,
    participant_count: 2,
    visible: true,
    closed: false,
    archived: false,
    image_url: null,
    post_stream: {
      posts,
      stream: [1, 2],
    },
    details: {
      participants: [],
      created_by: {
        id: 10,
        username: 'alice',
        name: 'Alice',
        avatar_template: '/user_avatar/example.com/alice/{size}/1.png',
      },
      last_poster: {
        id: 20,
        username: 'bob',
        name: 'Bob',
        avatar_template: '/user_avatar/example.com/bob/{size}/1.png',
      },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchTopicPostIds).mockImplementation(
    async (topic) =>
      topic.post_stream.stream ??
      topic.post_stream.posts.map((post) => post.id),
  );
  vi.mocked(resolveUploadUrls).mockResolvedValue(new Map());
  vi.mocked(fetchCategoryName).mockResolvedValue('General');
});

describe('buildTopicExport solved metadata', () => {
  it('uses topic-level accepted answer metadata', async () => {
    const topic = mockTopic({
      accepted_answer: {
        post_number: 2,
        username: 'bob',
        name: 'Bob',
      },
    });
    vi.mocked(fetchTopic).mockResolvedValue(topic);
    vi.mocked(fetchAllPosts).mockResolvedValue(topic.post_stream.posts);

    const exportData = await buildTopicExport({
      topicId: 123,
      origin: 'https://example.com',
      forumName: 'Example',
      formatVersion: FORMAT_VERSION,
      config: { ...DEFAULTS },
    });

    expect(exportData.markdown).toContain('解决方案：[[#^floor-2|#2]]');
    expect(exportData.markdown).toContain('✅ 解决方案');
    expect(exportData.markdown.match(/Accepted answer body/g)?.length).toBe(1);
  });

  it('falls back to post-level accepted answer metadata', async () => {
    const posts = [
      mockPost({ post_number: 1 }),
      mockPost({ post_number: 2, accepted_answer: true }),
    ];
    const topic = mockTopic({ post_stream: { posts, stream: [1, 2] } });
    vi.mocked(fetchTopic).mockResolvedValue(topic);
    vi.mocked(fetchAllPosts).mockResolvedValue(posts);

    const exportData = await buildTopicExport({
      topicId: 123,
      origin: 'https://example.com',
      forumName: 'Example',
      formatVersion: FORMAT_VERSION,
      config: { ...DEFAULTS },
    });

    expect(exportData.markdown).toContain('解决方案：[[#^floor-2|#2]]');
    expect(exportData.markdown).toContain('✅ 解决方案');
    expect(exportData.markdown).toContain('^floor-2');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const allFilters: FilterConfig = {
  rangeMode: 'all',
  rangeStart: 1,
  rangeEnd: Infinity,
  onlyOp: false,
  imgFilter: 'none',
  users: [],
  includeKeywords: [],
  excludeKeywords: [],
  minLength: 0,
};
const exportOptions = {
  topicId: 123,
  origin: 'https://collection.example',
  forumName: 'Fixture',
  formatVersion: FORMAT_VERSION,
  config: { ...DEFAULTS, batchDelayMin: 0, batchDelayMax: 0 },
};

async function useActualApi(): Promise<void> {
  const api =
    await vi.importActual<typeof import('../src/core/api')>('../src/core/api');
  vi.mocked(fetchTopic).mockImplementation(api.fetchTopic);
  vi.mocked(fetchAllPosts).mockImplementation(api.fetchAllPosts);
  vi.mocked(fetchTopicPostIds).mockImplementation(api.fetchTopicPostIds);
  vi.mocked(fetchCategoryName).mockImplementation(api.fetchCategoryName);
  vi.mocked(resolveUploadUrls).mockImplementation(api.resolveUploadUrls);
}

describe('collection and filtering contracts', () => {
  it('freezes selection, filters and output before waiting, despite navigation and caller mutation', async () => {
    const selected = new Set([2]);
    const selectedIds = new Map([[2, 902]]);
    const filters: FilterConfig = {
      ...allFilters,
      rangeMode: 'selected' as const,
      users: [],
      includeKeywords: [],
      excludeKeywords: [],
    };
    const config = { ...DEFAULTS, floorTemplate: '{{content}} {{block_ref}}' };
    let release!: (topic: DiscourseTopic) => void;
    vi.mocked(fetchTopic).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const post = mockPost({
      id: 902,
      post_number: 2,
      raw: 'Original selected body',
    });
    vi.mocked(fetchAllPosts).mockResolvedValue([post]);
    const pending = buildTopicExport({
      ...exportOptions,
      config,
      filters,
      selectedPosts: selected,
      selectedPostIds: selectedIds,
    });
    selected.clear();
    selectedIds.clear();
    filters.users.push('unrelated-user');
    config.floorTemplate = 'Changed output';
    release(
      mockTopic({ post_stream: { posts: [mockPost()], stream: [1, 902] } }),
    );
    const exported = await pending;
    expect(exported.markdown).toContain('Original selected body ^floor-2');
    expect(exported.markdown).not.toContain('Changed output');
    expect(fetchAllPosts).toHaveBeenCalledWith(
      123,
      [902],
      expect.any(Array),
      expect.any(Object),
      undefined,
      { origin: exportOptions.origin, signal: undefined },
    );
    expect(exported.origin).toBe(exportOptions.origin);
  });

  it('fails clearly before collection or delivery when selection is empty, unavailable, or no posts match', async () => {
    await expect(
      buildTopicExport({
        ...exportOptions,
        filters: { ...allFilters, rangeMode: 'selected' },
        selectedPosts: new Set(),
      }),
    ).rejects.toThrow('No posts selected');
    expect(fetchTopic).not.toHaveBeenCalled();
    const topic = mockTopic();
    vi.mocked(fetchTopic).mockResolvedValue(topic);
    vi.mocked(fetchAllPosts).mockResolvedValue(topic.post_stream.posts);
    await expect(
      buildTopicExport({
        ...exportOptions,
        filters: { ...allFilters, rangeMode: 'selected' },
        selectedPosts: new Set([99]),
      }),
    ).rejects.toThrow('unavailable');
    await expect(
      buildTopicExport({
        ...exportOptions,
        filters: { ...allFilters, includeKeywords: ['unmatched'] },
      }),
    ).rejects.toThrow('No posts match');
    expect(resolveUploadUrls).not.toHaveBeenCalled();
  });

  it('never rebinds a persisted selected floor to a different stable post ID', async () => {
    vi.mocked(fetchTopic).mockResolvedValue(
      mockTopic({
        post_stream: {
          posts: [mockPost({ id: 999, post_number: 7 })],
          stream: [999],
        },
      }),
    );
    await expect(
      buildTopicExport({
        ...exportOptions,
        filters: { ...allFilters, rangeMode: 'selected' },
        selectedPosts: new Set([7]),
        selectedPostIds: new Map([[7, 902]]),
      }),
    ).rejects.toThrow('identity changed');
    expect(fetchAllPosts).not.toHaveBeenCalled();
    vi.mocked(fetchTopic).mockResolvedValue(
      mockTopic({
        post_stream: { posts: [mockPost()], stream: [1, 902, 999] },
      }),
    );
    vi.mocked(fetchAllPosts).mockResolvedValue([
      mockPost({ id: 999, post_number: 7 }),
      mockPost({ id: 902, post_number: 9 }),
    ]);
    await expect(
      buildTopicExport({
        ...exportOptions,
        filters: { ...allFilters, rangeMode: 'selected' },
        selectedPosts: new Set([7, 9]),
        selectedPostIds: new Map([
          [7, 902],
          [9, 999],
        ]),
      }),
    ).rejects.toThrow('unavailable');
  });

  it('falls back to complete normal-stream collection when username post_ids is unsupported', async () => {
    await useActualApi();
    const posts = [
      mockPost({ id: 101, post_number: 1, raw: 'Unmatched OP' }),
      mockPost({
        id: 902,
        post_number: 7,
        username: 'BoB',
        raw: 'Matched via fallback',
      }),
    ];
    const topic = mockTopic({
      post_stream: { posts: [posts[0]], stream: [101, 902] },
    });
    const requestUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requestUrls.push(url);
        const path = new URL(url).pathname;
        if (path.endsWith('/post_ids.json'))
          return new Response('{}', { status: 404 });
        const payload = path.endsWith('/posts.json')
          ? { post_stream: { posts: [posts[1]] } }
          : path === '/site.json'
            ? { categories: [{ id: 1, name: 'General' }] }
            : topic;
        return new Response(JSON.stringify(payload));
      }),
    );
    const exported = await buildTopicExport({
      ...exportOptions,
      filters: { ...allFilters, users: ['bob'] },
    });
    expect(exported.markdown).toContain('Matched via fallback');
    expect(exported.markdown).not.toContain('Unmatched OP');
    expect(
      requestUrls.filter((url) => url.includes('/post_ids.json')),
    ).toHaveLength(1);
  });

  it('only resolves resources from actual filtered posts', async () => {
    const posts = [
      mockPost({
        id: 101,
        post_number: 1,
        raw: 'Discard ![a](upload://discard.png)',
      }),
      mockPost({
        id: 902,
        post_number: 7,
        raw: 'Keep ![b](upload://keep.png)',
      }),
    ];
    vi.mocked(fetchTopic).mockResolvedValue(
      mockTopic({ post_stream: { posts, stream: [101, 902] } }),
    );
    vi.mocked(fetchAllPosts).mockResolvedValue(posts);
    const exported = await buildTopicExport({
      ...exportOptions,
      filters: {
        ...allFilters,
        rangeMode: 'range',
        rangeStart: 7,
        rangeEnd: 7,
      },
    });
    expect(resolveUploadUrls).toHaveBeenCalledWith(['upload://keep.png'], {
      origin: exportOptions.origin,
      signal: undefined,
    });
    expect(exported.markdown).toContain('Keep');
    expect(exported.markdown).not.toContain('Discard');
  });

  it('uses the same actual-image rule for raw and cooked-only posts while skipping code, emoji and avatar examples', async () => {
    const posts = [
      mockPost({
        id: 101,
        post_number: 1,
        raw: '`![example](upload://code.png)`',
        cooked: '<p>code only</p>',
      }),
      mockPost({
        id: 407,
        post_number: 4,
        raw: '![real](upload://real.png)',
        cooked: '<img src="/real.png">',
      }),
      mockPost({
        id: 902,
        post_number: 7,
        raw: undefined,
        cooked:
          '<p>Fallback image</p><img src="https://cdn.example.com/photo.png">',
      }),
      mockPost({
        id: 999,
        post_number: 9,
        raw: undefined,
        cooked:
          '<img class="emoji" src="/images/emoji/smile.png"><img class="avatar" src="/user_avatar/u.png">',
      }),
    ];
    vi.mocked(fetchTopic).mockResolvedValue(
      mockTopic({
        post_stream: { posts, stream: posts.map((post) => post.id) },
      }),
    );
    vi.mocked(fetchAllPosts).mockResolvedValue(posts);
    const exported = await buildTopicExport({
      ...exportOptions,
      filters: { ...allFilters, imgFilter: 'withImg' },
    });
    expect(exported.markdown).toContain('^floor-4');
    expect(exported.markdown).toContain('^floor-7');
    expect(exported.markdown).not.toContain('^floor-1');
    expect(exported.markdown).not.toContain('^floor-9');
    expect(resolveUploadUrls).toHaveBeenCalledWith(
      ['upload://real.png'],
      expect.any(Object),
    );
  });

  it('runs real collection-to-Markdown with stable selected IDs and records smaller request bytes', async () => {
    await useActualApi();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T00:00:00Z'));
    const posts = Array.from({ length: 10 }, (_, index) =>
      mockPost({
        id: 1000 + index * 17,
        post_number: 1 + index * 2,
        raw: `Body ${index} ` + 'x'.repeat(200),
      }),
    );
    const topic = mockTopic({
      post_stream: { posts: [posts[0]], stream: posts.map((post) => post.id) },
    });
    let responseBytes = 0;
    const requestUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requestUrls.push(url);
        const parsed = new URL(url);
        const payload = parsed.pathname.endsWith('/posts.json')
          ? {
              post_stream: {
                posts: posts.filter((post) =>
                  parsed.searchParams
                    .getAll('post_ids[]')
                    .includes(String(post.id)),
                ),
              },
            }
          : parsed.pathname === '/site.json'
            ? { categories: [{ id: 1, name: 'General' }] }
            : topic;
        const json = JSON.stringify(payload);
        responseBytes += new TextEncoder().encode(json).length;
        return new Response(json, {
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    await fetchCategoryName(1, { origin: exportOptions.origin });
    responseBytes = 0;
    requestUrls.length = 0;
    const chosen = [posts[4], posts[8]];
    const selectedPosts = new Set(chosen.map((post) => post.post_number));
    const selectedPostIds = new Map(
      chosen.map((post) => [post.post_number, post.id]),
    );
    const optimized = await buildTopicExport({
      ...exportOptions,
      filters: { ...allFilters, rangeMode: 'selected' },
      selectedPosts,
      selectedPostIds,
    });
    const selectedBytes = responseBytes;
    const selectedRequests = requestUrls.length;
    expect(
      requestUrls.filter((url) => url.includes('/posts.json')),
    ).toHaveLength(1);
    expect(
      new URL(
        requestUrls.find((url) => url.includes('/posts.json'))!,
      ).searchParams.getAll('post_ids[]'),
    ).toEqual(chosen.map((post) => String(post.id)));
    responseBytes = 0;
    requestUrls.length = 0;
    const fullFallback = await buildTopicExport({
      ...exportOptions,
      filters: { ...allFilters, rangeMode: 'selected' },
      selectedPosts,
    });
    const fullBytes = responseBytes;
    const fullRequests = requestUrls.length;
    expect(optimized.markdown).toBe(fullFallback.markdown);
    expect(selectedBytes).toBeLessThan(fullBytes);
    // Warm category metadata equally: both paths use metadata + one body batch.
    expect(selectedRequests).toBe(2);
    expect(fullRequests).toBe(2);
    console.info('[DXP fixture collection bytes]', {
      selectedRequests,
      selectedBytes,
      fullRequests,
      fullBytes,
    });
  });

  it('retains only exact usernames after the server keeps OP, including mega-topic candidates', async () => {
    await useActualApi();
    const posts = [
      mockPost({
        id: 101,
        post_number: 1,
        username: 'op',
        raw: 'OP automatically included',
      }),
      mockPost({
        id: 902,
        post_number: 7,
        username: 'BoB',
        raw: 'Matched user',
      }),
    ];
    const topic = mockTopic({
      post_stream: { posts: [posts[0]], isMegaTopic: true, lastId: 902 },
    });
    const requestUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requestUrls.push(url);
        const path = new URL(url).pathname;
        const payload = path.endsWith('/post_ids.json')
          ? { post_ids: [902] }
          : path.endsWith('/posts.json')
            ? { post_stream: { posts: [posts[1]] } }
            : path === '/site.json'
              ? { categories: [{ id: 1, name: 'General' }] }
              : topic;
        return new Response(JSON.stringify(payload));
      }),
    );
    const exported = await buildTopicExport({
      ...exportOptions,
      filters: { ...allFilters, users: ['bOb'] },
    });
    expect(exported.markdown).toContain('Matched user');
    expect(exported.markdown).not.toContain('OP automatically included');
    expect(
      requestUrls.some(
        (url) => new URL(url).searchParams.get('username_filters') === 'bOb',
      ),
    ).toBe(true);
  });
});
