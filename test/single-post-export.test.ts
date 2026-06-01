import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS } from '../src/config/defaults';
import { fetchPostById, fetchTopic, resolveUploadUrls } from '../src/core/api';
import { buildSinglePostMarkdown } from '../src/core/single-post-export';
import type { DiscoursePost, DiscourseTopic } from '../src/types';

vi.mock('../src/core/api', () => ({
  fetchPostById: vi.fn(),
  fetchTopic: vi.fn(),
  resolveUploadUrls: vi.fn(),
}));

function post(overrides: Partial<DiscoursePost> = {}): DiscoursePost {
  const postNumber = overrides.post_number ?? 1;
  return {
    id: postNumber,
    post_number: postNumber,
    post_type: 1,
    username: 'alice',
    name: 'Alice',
    avatar_template: '/user_avatar/example.com/alice/{size}/1.png',
    user_id: 10,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    cooked: '<p>Hello cooked</p>',
    raw: 'Hello raw',
    reply_count: 0,
    reply_to_post_number: null,
    quote_count: 0,
    reads: 1,
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
    post_url: `/t/topic/123/${postNumber}`,
    ...overrides,
  };
}

function topic(posts: DiscoursePost[]): DiscourseTopic {
  return {
    id: 123,
    title: 'Topic',
    fancy_title: 'Topic',
    slug: 'topic',
    category_id: 1,
    tags: [],
    posts_count: posts.length,
    created_at: '2026-01-01T00:00:00.000Z',
    views: 1,
    reply_count: 0,
    like_count: 0,
    word_count: 10,
    user_id: 10,
    highest_post_number: posts.length,
    participant_count: 1,
    visible: true,
    closed: false,
    archived: false,
    image_url: null,
    post_stream: {
      posts,
      stream: posts.map((candidate) => candidate.id),
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
        id: 10,
        username: 'alice',
        name: 'Alice',
        avatar_template: '/user_avatar/example.com/alice/{size}/1.png',
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchPostById).mockResolvedValue(null);
  vi.mocked(resolveUploadUrls).mockResolvedValue(new Map());
});

describe('buildSinglePostMarkdown', () => {
  it('builds Markdown from a post already present in the topic payload', async () => {
    const sourcePost = post({
      raw: 'Image: ![alt](upload://abc.png)',
    });
    vi.mocked(fetchTopic).mockResolvedValue(topic([sourcePost]));
    vi.mocked(resolveUploadUrls).mockResolvedValue(
      new Map([['upload://abc.png', 'https://cdn.example.com/abc.png']]),
    );

    const markdown = await buildSinglePostMarkdown({
      topicId: 123,
      postNumber: 1,
      postId: 1001,
      origin: 'https://example.com',
      config: { ...DEFAULTS },
    });

    expect(markdown).toContain('![alt](https://cdn.example.com/abc.png)');
    expect(fetchPostById).not.toHaveBeenCalled();
  });

  it('fetches the requested post by ID when it is missing from the topic payload', async () => {
    vi.mocked(fetchTopic).mockResolvedValue(topic([post({ post_number: 1 })]));
    vi.mocked(fetchPostById).mockResolvedValue(
      post({ id: 2002, post_number: 9, raw: 'Fetched post' }),
    );

    await expect(
      buildSinglePostMarkdown({
        topicId: 123,
        postNumber: 9,
        postId: 2002,
        origin: 'https://example.com',
        config: { ...DEFAULTS },
      }),
    ).resolves.toBe('Fetched post');

    expect(fetchPostById).toHaveBeenCalledWith(123, 2002);
  });

  it('uses cooked fallback when raw Markdown is unavailable', async () => {
    vi.mocked(fetchTopic).mockResolvedValue(
      topic([
        post({
          raw: undefined,
          cooked: '<p>Hello <strong>cooked</strong></p>',
        }),
      ]),
    );

    const markdown = await buildSinglePostMarkdown({
      topicId: 123,
      postNumber: 1,
      postId: 1001,
      origin: 'https://example.com',
      config: { ...DEFAULTS },
    });

    expect(markdown).toContain('Hello **cooked**');
  });

  it('rejects when neither topic payload nor post lookup contains the post', async () => {
    vi.mocked(fetchTopic).mockResolvedValue(topic([post({ post_number: 1 })]));

    await expect(
      buildSinglePostMarkdown({
        topicId: 123,
        postNumber: 7,
        postId: 7007,
        origin: 'https://example.com',
        config: { ...DEFAULTS },
      }),
    ).rejects.toThrow('Post #7 was not found in topic 123');
  });
});
