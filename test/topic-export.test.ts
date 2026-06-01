import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTopicExport } from '../src/core/topic-export';
import {
  fetchAllPosts,
  fetchCategoryName,
  fetchTopic,
  resolveUploadUrls,
} from '../src/core/api';
import { DEFAULTS } from '../src/config/defaults';
import { FORMAT_VERSION } from '../src/config/format-version';
import type { DiscoursePost, DiscourseTopic } from '../src/types';

vi.mock('../src/core/api', () => ({
  fetchTopic: vi.fn(),
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
    expect(exportData.processedPosts[1].is_solution).toBe(true);
  });
});
