import type {
  DiscourseTopic,
  DiscoursePost,
  Config,
  ProgressCallback,
} from '../types';
import { sleep, sleepRandom, retryDelayMs } from '../utils/timing';

export interface RequestContext {
  origin?: string;
  signal?: AbortSignal;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryAfterMs?: number,
  ) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
  }
}

const READ_TIMEOUT_MS = 60_000;
const categoryCache = new Map<string, Map<number, string>>();

function positiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readIds(value: unknown): number[] {
  if (!Array.isArray(value) || !value.every(positiveId)) {
    throw new Error('Invalid post ID list');
  }
  return [...new Set(value)];
}

function readPosts(value: unknown, topicId: number): DiscoursePost[] {
  if (!Array.isArray(value))
    throw new Error(`Invalid posts response for topic ${topicId}`);
  for (const post of value) {
    if (
      !record(post) ||
      !positiveId(post.id) ||
      !positiveId(post.post_number) ||
      post.topic_id !== topicId ||
      typeof post.cooked !== 'string' ||
      typeof post.username !== 'string' ||
      (post.raw !== undefined && typeof post.raw !== 'string')
    ) {
      throw new Error(`Invalid post response for topic ${topicId}`);
    }
  }
  return value as DiscoursePost[];
}

function requestUrl(path: string, context: RequestContext): string {
  return context.origin ? new URL(path, context.origin).href : path;
}

/** The timeout covers both the response headers and consumption of its body. */
async function readResponse<T>(
  url: string,
  consume: (response: Response) => Promise<T>,
  context: RequestContext,
  init: RequestInit = {},
  timeoutMs = READ_TIMEOUT_MS,
): Promise<T> {
  const attempts = !init.method || init.method === 'GET' ? 2 : 1;
  for (let attempt = 1; ; attempt++) {
    context.signal?.throwIfAborted();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort: ((reason: unknown) => void) | undefined;
    const abort = () => {
      const reason =
        context.signal?.reason ??
        new DOMException('Request aborted', 'AbortError');
      controller.abort(reason);
      rejectAbort?.(reason);
    };
    context.signal?.addEventListener('abort', abort, { once: true });
    try {
      return await Promise.race([
        (async () => {
          const response = await fetch(url, {
            ...init,
            signal: controller.signal,
          });
          if (!response.ok)
            throw new HttpError(
              response.status,
              retryDelayMs(
                response.headers?.get('Retry-After') ?? null,
                attempt,
              ),
            );
          return consume(response);
        })(),
        new Promise<never>((_, reject) => {
          rejectAbort = reject;
          if (context.signal?.aborted) abort();
          timer = setTimeout(() => {
            const reason = new DOMException(
              'Request timed out',
              'TimeoutError',
            );
            controller.abort(reason);
            reject(reason);
          }, timeoutMs);
        }),
      ]);
    } catch (error) {
      context.signal?.throwIfAborted();
      if (
        attempt >= attempts ||
        (error instanceof HttpError &&
          error.status !== 429 &&
          error.status < 500) ||
        (!(error instanceof HttpError) &&
          !(error instanceof TypeError) &&
          !(error instanceof DOMException && error.name === 'TimeoutError'))
      )
        throw error;
      const delay = error instanceof HttpError ? error.retryAfterMs : undefined;
      if (delay !== undefined) await sleep(delay, context.signal);
      else await sleep(retryDelayMs(null, attempt), context.signal);
    } finally {
      clearTimeout(timer);
      context.signal?.removeEventListener('abort', abort);
    }
  }
}

async function readJson(
  path: string,
  context: RequestContext,
  init?: RequestInit,
): Promise<unknown> {
  return readResponse(
    requestUrl(path, context),
    (response) => response.json(),
    context,
    init,
  );
}

/** Fetch topic metadata without a fabricated slug that could discard query parameters on redirect. */
export async function fetchTopic(
  topicId: number,
  context: RequestContext = {},
): Promise<DiscourseTopic> {
  if (!positiveId(topicId)) throw new Error('Invalid topic ID');
  const topic = await readJson(`/t/${topicId}.json?include_raw=true`, context);
  if (
    !record(topic) ||
    topic.id !== topicId ||
    typeof topic.title !== 'string' ||
    !positiveId(topic.category_id) ||
    !positiveId(topic.user_id) ||
    !record(topic.post_stream) ||
    !record(topic.details) ||
    !record(topic.details.created_by) ||
    typeof topic.details.created_by.username !== 'string'
  )
    throw new Error(`Invalid topic response for topic ${topicId}`);
  readPosts(topic.post_stream.posts, topicId);
  if (topic.post_stream.stream !== undefined) readIds(topic.post_stream.stream);
  else if (
    topic.post_stream.isMegaTopic !== true ||
    !positiveId(topic.post_stream.lastId)
  )
    throw new Error(`Invalid post stream for topic ${topicId}`);
  return topic as unknown as DiscourseTopic;
}

export async function fetchPostById(
  topicId: number,
  postId: number,
  context: RequestContext = {},
): Promise<DiscoursePost | null> {
  if (!positiveId(topicId) || !positiveId(postId))
    throw new Error('Invalid post ID');
  const payload = await readJson(
    `/t/${topicId}/posts.json?post_ids[]=${postId}&include_raw=true`,
    context,
  );
  const posts = readPosts(
    record(payload) && record(payload.post_stream)
      ? payload.post_stream.posts
      : undefined,
    topicId,
  );
  return posts.find((post) => post.id === postId) ?? null;
}

/**
 * post_ids with post_number=1 returns every visible ID after the first post (skip_limit).
 * Together with the first post this is an authoritative finite list, including for mega topics.
 * Protocol: Discourse TopicsController#post_ids / TopicView#filter_posts_by_post_number.
 */
export async function fetchTopicPostIds(
  topic: Pick<DiscourseTopic, 'id' | 'post_stream'>,
  context: RequestContext = {},
  usernames?: readonly string[],
): Promise<number[]> {
  if (!usernames?.length && topic.post_stream.stream)
    return readIds(topic.post_stream.stream);
  const firstPost = topic.post_stream.posts.find(
    (post) => post.post_number === 1,
  );
  if (!firstPost)
    throw new Error(
      `Cannot establish first visible post for topic ${topic.id}`,
    );
  const params = new URLSearchParams({ post_number: '1' });
  if (usernames?.length) params.set('username_filters', usernames.join(','));
  const payload = await readJson(
    `/t/${topic.id}/post_ids.json?${params}`,
    context,
  );
  const ids = readIds(record(payload) ? payload.post_ids : undefined);
  const completeIds = [...new Set([firstPost.id, ...ids])];
  if (
    !usernames?.length &&
    topic.post_stream.isMegaTopic &&
    !completeIds.includes(topic.post_stream.lastId!)
  ) {
    throw new Error(
      `Incomplete mega-topic ID list for topic ${topic.id}: last post is missing`,
    );
  }
  return completeIds;
}

export async function fetchAllPosts(
  topicId: number,
  stream: readonly number[],
  initialPosts: DiscoursePost[],
  config: Pick<Config, 'batchSize' | 'batchDelayMin' | 'batchDelayMax'>,
  onProgress?: ProgressCallback,
  context: RequestContext = {},
): Promise<DiscoursePost[]> {
  const expectedIds = readIds(stream);
  const expected = new Set(expectedIds);
  const allPosts = new Map(
    readPosts(initialPosts, topicId)
      .filter((post) => expected.has(post.id))
      .map((post) => [post.id, post]),
  );
  const missingIds = expectedIds.filter((id) => !allPosts.has(id));
  if (
    !Number.isSafeInteger(config.batchSize) ||
    config.batchSize < 1 ||
    config.batchSize > 100
  ) {
    throw new Error('Invalid request batch size');
  }
  for (let i = 0; i < missingIds.length; i += config.batchSize) {
    context.signal?.throwIfAborted();
    if (i > 0)
      await sleepRandom(
        config.batchDelayMin,
        config.batchDelayMax,
        context.signal,
      );
    const batch = missingIds.slice(i, i + config.batchSize);
    onProgress?.(
      `拉取帖子 ${allPosts.size}/${expectedIds.length}`,
      allPosts.size / expectedIds.length,
    );
    const query = batch.map((id) => `post_ids[]=${id}`).join('&');
    const payload = await readJson(
      `/t/${topicId}/posts.json?${query}&include_raw=true`,
      context,
    );
    const posts = readPosts(
      record(payload) && record(payload.post_stream)
        ? payload.post_stream.posts
        : undefined,
      topicId,
    );
    for (const post of posts)
      if (expected.has(post.id)) allPosts.set(post.id, post);
    const missing = batch.filter((id) => !allPosts.has(id));
    if (missing.length)
      throw new Error(
        `Failed to fetch all posts for topic ${topicId}: missing ${missing.length}`,
      );
  }
  return [...allPosts.values()].sort((a, b) => a.post_number - b.post_number);
}

export async function resolveUploadUrls(
  shortUrls: string[],
  context: RequestContext = {},
): Promise<Map<string, string>> {
  const uploads = new Map<string, string>();
  const unique = [...new Set(shortUrls)];
  for (let i = 0; i < unique.length; i += 50) {
    context.signal?.throwIfAborted();
    try {
      const csrfToken =
        document
          .querySelector('meta[name="csrf-token"]')
          ?.getAttribute('content') ?? '';
      const payload = await readJson('/uploads/lookup-urls', context, {
        method: 'POST',
        body: JSON.stringify({ short_urls: unique.slice(i, i + 50) }),
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json',
        },
      });
      if (!Array.isArray(payload))
        throw new Error('Invalid upload URL response');
      for (const upload of payload) {
        if (
          record(upload) &&
          typeof upload.short_url === 'string' &&
          typeof upload.url === 'string'
        ) {
          uploads.set(upload.short_url, upload.url);
        }
      }
    } catch (error) {
      context.signal?.throwIfAborted();
      console.warn('[DXP] /uploads/lookup-urls failed:', error);
    }
  }
  return uploads;
}

/** Page breadcrumbs are not an authority for a different category or topic. */
export async function fetchCategoryName(
  categoryId: number,
  context: RequestContext = {},
): Promise<string> {
  if (!positiveId(categoryId)) throw new Error('Invalid category ID');
  const origin = context.origin ?? location.origin;
  try {
    let categories = categoryCache.get(origin);
    if (!categories) {
      const payload = await readJson('/site.json', { ...context, origin });
      if (!record(payload) || !Array.isArray(payload.categories))
        throw new Error('Invalid categories response');
      categories = new Map();
      for (const category of payload.categories) {
        if (
          record(category) &&
          positiveId(category.id) &&
          typeof category.name === 'string'
        ) {
          categories.set(category.id, category.name);
        }
      }
      categoryCache.set(origin, categories);
    }
    return categories.get(categoryId) ?? `category-${categoryId}`;
  } catch (error) {
    context.signal?.throwIfAborted();
    console.warn('[DXP] Category lookup failed:', error);
    return `category-${categoryId}`;
  }
}

export async function fetchBinary(
  url: string,
  timeoutMs = READ_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  return readResponse(
    url,
    async (response) => new Uint8Array(await response.arrayBuffer()),
    { signal },
    {},
    timeoutMs,
  );
}
