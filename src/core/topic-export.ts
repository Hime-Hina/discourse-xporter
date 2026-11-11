import type {
  Config,
  DiscoursePost,
  DiscourseTopic,
  FilterConfig,
  PipelineContext,
  ProgressCallback,
} from '../types';
import {
  fetchAllPosts,
  fetchCategoryName,
  fetchTopic,
  fetchTopicPostIds,
  HttpError,
  resolveUploadUrls,
} from './api';
import { assembleDocument, buildFrontmatter, processPost } from './formatter';
import { DEFAULT_FLOOR_TEMPLATE } from '../config/defaults';
import { safeFilename } from '../utils/filename';
import { getRenderedPostNumbers } from '../utils/obsidian';
import { buildExportProfile } from './export-profile';
import { hasPostImages } from '../utils/markdown-links';

export interface TopicExportOptions {
  topicId: number;
  origin: string;
  forumName: string;
  formatVersion: number;
  config: Config;
  filters?: FilterConfig;
  selectedPosts?: ReadonlySet<number>;
  selectedPostIds?: ReadonlyMap<number, number>;
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
}

export interface TopicExportResult {
  origin: string;
  markdown: string;
  safeTitle: string;
  topicId: number;
}

export async function buildTopicExport(
  options: TopicExportOptions,
): Promise<TopicExportResult> {
  const { topicId, forumName, formatVersion, onProgress, signal } = options;
  const origin = new URL(options.origin).origin;
  const config = { ...options.config };
  const filters = options.filters
    ? {
        ...options.filters,
        users: [...options.filters.users],
        includeKeywords: [...options.filters.includeKeywords],
        excludeKeywords: [...options.filters.excludeKeywords],
      }
    : undefined;
  const selectedPosts = new Set(options.selectedPosts);
  const selectedPostIds = new Map(options.selectedPostIds);
  const context = { origin, signal };
  if (filters?.rangeMode === 'selected' && selectedPosts.size === 0) {
    throw new Error('No posts selected');
  }
  signal?.throwIfAborted();
  onProgress?.('获取话题信息…', 0);
  const topic = await fetchTopic(topicId, context);
  for (const post of topic.post_stream.posts) {
    if (selectedPosts.has(post.post_number)) {
      const expectedId = selectedPostIds.get(post.post_number);
      if (expectedId !== undefined && expectedId !== post.id) {
        throw new Error(`Selected post #${post.post_number} identity changed`);
      }
      selectedPostIds.set(post.post_number, post.id);
    }
  }

  let ids: number[];
  if (
    filters?.rangeMode === 'selected' &&
    [...selectedPosts].every((number) => selectedPostIds.has(number))
  ) {
    ids = [...selectedPosts].map((number) => selectedPostIds.get(number)!);
  } else {
    const usernames = filters?.onlyOp
      ? [topic.details.created_by.username]
      : filters?.users;
    if (usernames?.length) {
      try {
        ids = await fetchTopicPostIds(topic, context, usernames);
      } catch (error) {
        if (
          !(error instanceof HttpError) ||
          ![400, 404, 422].includes(error.status)
        )
          throw error;
        ids = await fetchTopicPostIds(topic, context);
      }
    } else {
      ids = await fetchTopicPostIds(topic, context);
    }
  }
  const allPosts = await fetchAllPosts(
    topicId,
    ids,
    topic.post_stream.posts,
    config,
    onProgress,
    context,
  );
  if (filters?.rangeMode === 'selected') {
    const fetchedByNumber = new Map(
      allPosts.map((post) => [post.post_number, post]),
    );
    if (
      [...selectedPosts].some((number) => {
        const post = fetchedByNumber.get(number);
        const expectedId = selectedPostIds.get(number);
        return !post || (expectedId !== undefined && post.id !== expectedId);
      })
    ) {
      throw new Error('Some selected posts are unavailable');
    }
  }
  const posts = filters
    ? applyFilters(allPosts, topic, filters, selectedPosts)
    : allPosts;
  if (!posts.length) throw new Error('No posts match the export filters');
  for (const post of allPosts) {
    if (selectedPosts.has(post.post_number)) {
      const expectedId = selectedPostIds.get(post.post_number);
      if (expectedId !== undefined && expectedId !== post.id) {
        throw new Error(`Selected post #${post.post_number} identity changed`);
      }
      selectedPostIds.set(post.post_number, post.id);
    }
  }
  onProgress?.('解析资源链接…', 0.5);
  const uploadMap = await resolveUploadUrls(collectUploadUrls(posts), context);
  const categoryName = await fetchCategoryName(topic.category_id, context);
  signal?.throwIfAborted();
  const acceptedAnswerPostNumber = resolveAcceptedAnswerPostNumber(
    topic,
    allPosts,
  );

  const template = config.floorTemplate || DEFAULT_FLOOR_TEMPLATE;
  const renderedPostNumbers = getRenderedPostNumbers(
    posts.map((post) => post.post_number),
    template,
  );
  onProgress?.('处理内容…', 0.6);
  const processedPosts = posts.map((post) => {
    const ctx: PipelineContext = {
      origin,
      topicId,
      polls: post.polls ?? [],
      cookedHtml: post.cooked,
      uploadMap,
      renderedPostNumbers,
    };
    const postForProcessing =
      post.post_number === acceptedAnswerPostNumber
        ? { ...post, accepted_answer: true }
        : post;
    return processPost(
      postForProcessing,
      topic.user_id,
      ctx,
      selectedPosts.has(post.post_number),
    );
  });

  const tags =
    topic.tags?.map((t) => (typeof t === 'string' ? t : t.name)) ?? [];
  tags.push(forumName.replace(/\s+/g, '-'));

  const frontmatter = buildFrontmatter({
    title: topic.title,
    source: `${origin}/t/topic/${topicId}`,
    author: topic.details.created_by.username,
    category: categoryName,
    forum: forumName,
    tags,
    created: toLocalISO(new Date(topic.created_at)),
    exported: toLocalISO(new Date()),
    topic_id: topicId,
    slug: topic.slug,
    posts_count: topic.posts_count,
    reply_count: topic.reply_count,
    views: topic.views,
    likes: topic.like_count,
    word_count: topic.word_count ?? 0,
    participants: topic.participant_count,
    closed: topic.closed,
    archived: topic.archived,
    xporter_version: formatVersion,
    export_profile: buildExportProfile(
      { ...config, floorTemplate: template },
      filters,
      selectedPostIds,
      selectedPosts,
    ),
  });

  return {
    origin,
    markdown: assembleDocument(
      frontmatter,
      processedPosts,
      template,
      origin,
      topicId,
      acceptedAnswerPostNumber,
    ),
    safeTitle: safeFilename(topic.title) || `topic-${topicId}`,
    topicId,
  };
}

function resolveAcceptedAnswerPostNumber(
  topic: DiscourseTopic,
  posts: DiscoursePost[],
): number | undefined {
  const topicAcceptedAnswerPostNumber = topic.accepted_answer?.post_number;
  if (typeof topicAcceptedAnswerPostNumber === 'number') {
    return topicAcceptedAnswerPostNumber;
  }

  return posts.find((post) => post.accepted_answer)?.post_number;
}

function collectUploadUrls(posts: DiscoursePost[]): string[] {
  const urls: string[] = [];
  for (const post of posts) {
    const matches = post.raw?.match(/upload:\/\/[a-zA-Z0-9._-]+/g);
    if (matches) urls.push(...matches);
  }
  return urls;
}

function applyFilters(
  posts: DiscoursePost[],
  topic: DiscourseTopic,
  filters: FilterConfig,
  selectedPosts: ReadonlySet<number> = new Set<number>(),
): DiscoursePost[] {
  let result = posts;

  if (filters.rangeMode === 'range') {
    result = result.filter(
      (p) =>
        p.post_number >= filters.rangeStart &&
        p.post_number <= filters.rangeEnd,
    );
  } else if (filters.rangeMode === 'selected') {
    result = result.filter((p) => selectedPosts.has(p.post_number));
  }

  if (filters.onlyOp) {
    result = result.filter((p) => p.user_id === topic.user_id);
  }

  if (filters.imgFilter === 'withImg') {
    result = result.filter((p) => hasPostImages(p.raw, p.cooked));
  } else if (filters.imgFilter === 'noImg') {
    result = result.filter((p) => !hasPostImages(p.raw, p.cooked));
  }

  if (filters.users.length > 0) {
    const userSet = new Set(filters.users.map((u) => u.toLowerCase()));
    result = result.filter((p) => userSet.has(p.username.toLowerCase()));
  }

  if (filters.includeKeywords.length > 0) {
    result = result.filter((p) => {
      const text = (p.raw ?? p.cooked).toLowerCase();
      return filters.includeKeywords.some((kw) =>
        text.includes(kw.toLowerCase()),
      );
    });
  }

  if (filters.excludeKeywords.length > 0) {
    result = result.filter((p) => {
      const text = (p.raw ?? p.cooked).toLowerCase();
      return !filters.excludeKeywords.some((kw) =>
        text.includes(kw.toLowerCase()),
      );
    });
  }

  if (filters.minLength > 0) {
    result = result.filter(
      (p) => (p.raw ?? p.cooked).length >= filters.minLength,
    );
  }

  return result;
}

/** Format a Date as YYYY-MM-DDTHH:mm:ss in Asia/Shanghai. */
function toLocalISO(date: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const p = Object.fromEntries(
    fmt.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
