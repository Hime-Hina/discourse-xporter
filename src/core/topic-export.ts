import type {
  Config,
  DiscoursePost,
  DiscourseTopic,
  FilterConfig,
  PipelineContext,
  ProcessedPost,
  ProgressCallback,
} from '../types';
import {
  fetchAllPosts,
  fetchCategoryName,
  fetchTopic,
  resolveUploadUrls,
} from './api';
import {
  assembleDocument,
  buildFrontmatter,
  processPost,
} from './formatter';
import { DEFAULT_FLOOR_TEMPLATE } from '../config/defaults';
import { safeFilename } from '../utils/filename';

export interface TopicExportOptions {
  topicId: number;
  origin: string;
  forumName: string;
  formatVersion: number;
  config: Config;
  filters?: FilterConfig;
  selectedPosts?: Set<number>;
  onProgress?: ProgressCallback;
}

export interface TopicExportResult {
  topic: DiscourseTopic;
  allPosts: DiscoursePost[];
  processedPosts: ProcessedPost[];
  markdown: string;
  safeTitle: string;
  topicId: number;
}

export async function buildTopicExport(
  options: TopicExportOptions,
): Promise<TopicExportResult> {
  const { topicId, config, onProgress } = options;

  onProgress?.('获取话题信息…', 0);
  const topic = await fetchTopic(topicId);

  const allPosts = await fetchAllPosts(
    topicId,
    topic.post_stream.stream,
    topic.post_stream.posts,
    config,
    onProgress,
  );

  onProgress?.('解析资源链接…', 0.5);
  const uploadMap = await resolveUploadUrls(collectUploadUrls(allPosts));
  const categoryName = await fetchCategoryName(topic.category_id);
  const posts = options.filters
    ? applyFilters(allPosts, topic, options.filters, options.selectedPosts)
    : allPosts;
  const acceptedAnswerPostNumber = resolveAcceptedAnswerPostNumber(
    topic,
    allPosts,
  );

  onProgress?.('处理内容…', 0.6);
  const processedPosts = posts.map((post) => {
    const ctx: PipelineContext = {
      origin: options.origin,
      topicId,
      topicSlug: topic.slug,
      polls: post.polls ?? [],
      cookedHtml: post.cooked,
      config,
      uploadMap,
    };
    const postForProcessing =
      post.post_number === acceptedAnswerPostNumber
        ? { ...post, accepted_answer: true }
        : post;
    return processPost(
      postForProcessing,
      topic.user_id,
      ctx,
      options.selectedPosts?.has(post.post_number) ?? false,
    );
  });

  const tags = topic.tags?.map((t) => (typeof t === 'string' ? t : t.name)) ?? [];
  tags.push(options.forumName.replace(/\s+/g, '-'));

  const frontmatter = buildFrontmatter({
    title: topic.title,
    source: `${options.origin}/t/topic/${topicId}`,
    author: topic.details.created_by.username,
    category: categoryName,
    forum: options.forumName,
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
    xporter_version: options.formatVersion,
  });

  const template = config.floorTemplate || DEFAULT_FLOOR_TEMPLATE;
  return {
    topic,
    allPosts,
    processedPosts,
    markdown: assembleDocument(
      frontmatter,
      processedPosts,
      template,
      options.origin,
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
  selectedPosts = new Set<number>(),
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
    result = result.filter((p) => /!\[.*?\]\(.*?\)/.test(p.raw ?? p.cooked));
  } else if (filters.imgFilter === 'noImg') {
    result = result.filter((p) => !/!\[.*?\]\(.*?\)/.test(p.raw ?? p.cooked));
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
