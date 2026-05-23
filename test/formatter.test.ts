import { describe, it, expect } from 'vitest';
import type { DiscoursePost, PipelineContext, ProcessedPost } from '../src/types';
import {
  buildFrontmatter,
  processPost,
  renderTemplate,
  buildTemplateVars,
} from '../src/core/formatter';
import type { FrontmatterData, TemplateVars } from '../src/core/formatter';
import { DEFAULTS } from '../src/config/defaults';

function mockPost(overrides: Partial<ProcessedPost> = {}): ProcessedPost {
  return {
    post_number: 1,
    username: 'alice',
    name: 'Alice Wang',
    avatar_url: 'https://example.com/avatar.png',
    created_at: '2026-04-12T10:30:00.000Z',
    trust_level: 2,
    is_op: false,
    reply_to_post_number: null,
    likes: 5,
    reactions: [{ id: 'heart', type: '❤️', count: 5 }],
    edit_count: 0,
    is_wiki: false,
    post_url: 'https://example.com/t/test-topic/12345/1',
    content: 'Hello world',
    selected: false,
    ...overrides,
  };
}

describe('buildFrontmatter', () => {
  it('generates valid YAML with all fields', () => {
    const data: FrontmatterData = {
      title: 'Test Topic',
      source: 'https://example.com/t/test-topic/123',
      author: 'alice',
      category: 'General',
      forum: 'LINUX DO',
      tags: ['tag1', 'tag2'],
      created: '2026-04-12T10:30:00',
      exported: '2026-04-12T12:00:00',
      topic_id: 123,
      slug: 'test-topic',
      posts_count: 10,
      reply_count: 8,
      views: 500,
      likes: 42,
      word_count: 3000,
      participants: 5,
      closed: false,
      archived: false,
      xporter_version: 1,
    };
    const result = buildFrontmatter(data);
    expect(result).toContain('---');
    expect(result).toContain('xporter_version: 1');
    expect(result).toContain('title: Test Topic');
    expect(result).toContain('source: "https://example.com/t/test-topic/123"');
    expect(result).toContain('author: alice');
    expect(result).toContain('category: General');
    expect(result).toContain('forum: LINUX DO');
    expect(result).toContain('  - tag1');
    expect(result).toContain('  - tag2');
    expect(result).toContain('topic_id: 123');
    expect(result).toContain('slug: test-topic');
    expect(result).toContain('posts_count: 10');
    expect(result).toContain('reply_count: 8');
    expect(result).toContain('views: 500');
    expect(result).toContain('likes: 42');
    expect(result).toContain('word_count: 3000');
    expect(result).toContain('participants: 5');
    // closed/archived false → should not appear
    expect(result).not.toContain('closed');
    expect(result).not.toContain('archived');
  });

  it('escapes special chars in title', () => {
    const data: FrontmatterData = {
      title: 'Title with: colon & "quotes"',
      source: 'https://example.com',
      author: 'bob',
      category: 'Test',
      forum: 'example.com',
      tags: [],
      created: '2026-01-01T00:00:00',
      exported: '2026-01-01T00:00:00',
      topic_id: 1,
      slug: 'test',
      posts_count: 1,
      reply_count: 0,
      views: 1,
      likes: 0,
      word_count: 100,
      participants: 1,
      closed: false,
      archived: false,
      xporter_version: 1,
    };
    const result = buildFrontmatter(data);
    expect(result).toContain('title: "Title with: colon & \\"quotes\\""');
  });

  it('escapes tags and multiline scalar values', () => {
    const data: FrontmatterData = {
      title: 'Line 1\nLine 2',
      source: 'https://example.com',
      author: 'bob',
      category: 'Test',
      forum: 'example.com',
      tags: ['topic:tag', ' #hash ', 'line\nbreak'],
      created: '2026-01-01T00:00:00',
      exported: '2026-01-01T00:00:00',
      topic_id: 1,
      slug: 'test',
      posts_count: 1,
      reply_count: 0,
      views: 1,
      likes: 0,
      word_count: 100,
      participants: 1,
      closed: false,
      archived: false,
      xporter_version: 1,
    };

    const result = buildFrontmatter(data);

    expect(result).toContain('title: "Line 1\\nLine 2"');
    expect(result).toContain('  - "topic:tag"');
    expect(result).toContain('  - " #hash "');
    expect(result).toContain('  - "line\\nbreak"');
  });
});

describe('renderTemplate', () => {
  it('replaces all template variables', () => {
    const template = '## #{{post_number}} by {{author_full}} on {{date}}';
    const vars: TemplateVars = {
      post_number: 3,
      floor_link: '#3',
      username: 'alice',
      author: 'Alice Wang',
      author_full: 'Alice Wang (@alice)',
      avatar_url: 'https://example.com/avatar.png',
      date: '2026-04-12 10:30',
      date_iso: '2026-04-12T10:30:00.000Z',
      likes: 5,
      likes_display: ' · ❤️ 5',
      reply_to: '',
      reply_to_display: '',
      trust_level: 2,
      is_op: false,
      op_badge: '',
      op_badge_display: '',
      post_url: 'https://example.com/t/test/123/3',
      reactions: '❤️ 5',
      edit_count: 0,
      is_wiki: false,
      content: 'Hello world',
      highlight: '',
      block_ref: '',
    };
    const result = renderTemplate(template, vars);
    expect(result).toBe('## #3 by Alice Wang (@alice) on 2026-04-12 10:30');
  });

  it('leaves unknown variables as-is', () => {
    const template = '{{post_number}} and {{nonexistent}}';
    const vars: TemplateVars = {
      post_number: 1,
      floor_link: '#1',
      username: 'a',
      author: 'a',
      author_full: '@a',
      avatar_url: '',
      date: '',
      date_iso: '',
      likes: 0,
      likes_display: '',
      reply_to: '',
      reply_to_display: '',
      trust_level: 0,
      is_op: false,
      op_badge: '',
      op_badge_display: '',
      post_url: '',
      reactions: '',
      edit_count: 0,
      is_wiki: false,
      content: '',
      highlight: '',
      block_ref: '',
    };
    const result = renderTemplate(template, vars);
    expect(result).toContain('1');
    expect(result).toContain('{{nonexistent}}');
  });

  it('handles $ in content without duplicating template prefix', () => {
    const template = '## #{{post_number}} by {{author_full}}\n\n{{content}}';
    const vars: TemplateVars = {
      post_number: 1,
      floor_link: '#1',
      username: 'alice',
      author: 'Alice',
      author_full: 'Alice (@alice)',
      avatar_url: '',
      date: '',
      date_iso: '',
      likes: 0,
      likes_display: '',
      reply_to: '',
      reply_to_display: '',
      trust_level: 0,
      is_op: false,
      op_badge: '',
      op_badge_display: '',
      post_url: '',
      reactions: '',
      edit_count: 0,
      is_wiki: false,
      content: 'Terminal prompt is `~ $` and `root@host:~#`',
      highlight: '',
      block_ref: '',
    };
    const result = renderTemplate(template, vars);
    // $ should not cause the template prefix to be duplicated
    expect(result).toBe('## #1 by Alice (@alice)\n\nTerminal prompt is `~ $` and `root@host:~#`');
    // Should appear exactly once
    expect(result.match(/## #1/g)?.length).toBe(1);
  });
});

describe('buildTemplateVars', () => {
  it('generates correct author_full for user with name', () => {
    const vars = buildTemplateVars(
      mockPost({ username: 'alice', name: 'Alice Wang' }),
      'https://example.com',
      12345,
    );
    expect(vars.author_full).toBe('Alice Wang (@alice)');
  });

  it('generates correct author_full for user without name', () => {
    const vars = buildTemplateVars(
      mockPost({ username: 'bob', name: '' }),
      'https://example.com',
      12345,
    );
    expect(vars.author_full).toBe('@bob');
  });

  it('sets likes_display empty when likes is 0', () => {
    const vars = buildTemplateVars(
      mockPost({ likes: 0 }),
      'https://example.com',
      12345,
    );
    expect(vars.likes_display).toBe('');
  });

  it('sets op_badge for OP', () => {
    const vars = buildTemplateVars(
      mockPost({ is_op: true }),
      'https://example.com',
      12345,
    );
    expect(vars.op_badge).toBe('🏠 楼主');
    expect(vars.op_badge_display).toContain('🏠 楼主');
  });

  it('sets empty op_badge for non-OP', () => {
    const vars = buildTemplateVars(
      mockPost({ is_op: false }),
      'https://example.com',
      12345,
    );
    expect(vars.op_badge).toBe('');
  });
});

describe('processPost', () => {
  it('defaults likes to zero when actions_summary is missing', () => {
    const post = {
      id: 1,
      post_number: 1,
      post_type: 1,
      username: 'alice',
      name: 'Alice',
      avatar_template: '/user_avatar/example.com/alice/{size}/1.png',
      user_id: 10,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      cooked: '<p>Hello</p>',
      raw: 'Hello',
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
      post_url: '/t/topic/123/1',
    } as DiscoursePost;
    const ctx: PipelineContext = {
      origin: 'https://example.com',
      topicId: 123,
      topicSlug: 'topic',
      polls: [],
      cookedHtml: post.cooked,
      config: { ...DEFAULTS },
      uploadMap: new Map(),
    };

    expect(processPost(post, 10, ctx, false).likes).toBe(0);
  });
});
