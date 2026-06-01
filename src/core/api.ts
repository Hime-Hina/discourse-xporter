import type {
  DiscourseTopic,
  DiscoursePost,
  UploadLookupResult,
  Config,
  ProgressCallback,
} from '../types';
import { sleepRandom } from '../utils/timing';

/** Get CSRF token from Discourse meta tag */
function getCsrfToken(): string {
  const meta = document.querySelector('meta[name="csrf-token"]');
  return meta?.getAttribute('content') ?? '';
}

/** Fetch topic metadata + first batch of posts */
export async function fetchTopic(topicId: number): Promise<DiscourseTopic> {
  const res = await fetch(`/t/topic/${topicId}.json?include_raw=true`);
  if (!res.ok)
    throw new Error(`Failed to fetch topic ${topicId}: HTTP ${res.status}`);
  return res.json();
}

/** Fetch one post by its stable post ID. */
export async function fetchPostById(
  topicId: number,
  postId: number,
): Promise<DiscoursePost | null> {
  const res = await fetch(
    `/t/${topicId}/posts.json?post_ids[]=${postId}&include_raw=true`,
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch post ${postId}: HTTP ${res.status}`);
  }

  const postsPayload = await res.json();
  const posts = postsPayload?.post_stream?.posts;
  if (!Array.isArray(posts)) {
    throw new Error(`Invalid post response for topic ${topicId}`);
  }

  return posts[0] ?? null;
}

/** Fetch missing posts in batches */
export async function fetchAllPosts(
  topicId: number,
  stream: number[],
  initialPosts: DiscoursePost[],
  config: Config,
  onProgress?: ProgressCallback,
): Promise<DiscoursePost[]> {
  const allPosts = [...initialPosts];
  const fetchedIds = new Set(allPosts.map((p) => p.id));
  const missingIds = stream.filter((id) => !fetchedIds.has(id));
  const batchSize = Math.max(1, Math.floor(config.batchSize));

  for (let i = 0; i < missingIds.length; i += batchSize) {
    if (i > 0) await sleepRandom(config.batchDelayMin, config.batchDelayMax);

    const batch = missingIds.slice(i, i + batchSize);
    const progress = allPosts.length / stream.length;
    onProgress?.(`拉取帖子 ${allPosts.length}/${stream.length}`, progress);

    const qs = batch.map((id) => `post_ids[]=${id}`).join('&');
    const res = await fetchWithRetry(
      `/t/${topicId}/posts.json?${qs}&include_raw=true`,
    );
    const data = await res.json();
    const posts = data?.post_stream?.posts;
    if (!Array.isArray(posts)) {
      throw new Error(`Invalid posts response for topic ${topicId}`);
    }
    allPosts.push(...posts);
  }

  const resultIds = new Set(allPosts.map((p) => p.id));
  const stillMissing = stream.filter((id) => !resultIds.has(id));
  if (stillMissing.length > 0) {
    throw new Error(
      `Failed to fetch all posts for topic ${topicId}: missing ${stillMissing.length}`,
    );
  }

  allPosts.sort((a, b) => a.post_number - b.post_number);
  return allPosts;
}

/** Batch resolve upload:// short URLs to full CDN URLs */
export async function resolveUploadUrls(
  shortUrls: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (shortUrls.length === 0) return map;

  // Deduplicate
  const unique = [...new Set(shortUrls)];

  // Batch in chunks of 50 to avoid oversized requests
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    try {
      const csrfToken = getCsrfToken();
      const res = await fetch('/uploads/lookup-urls', {
        method: 'POST',
        body: JSON.stringify({ short_urls: batch }),
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json',
        },
      });
      if (res.ok) {
        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
          console.warn(
            '[DXP] /uploads/lookup-urls returned non-JSON:',
            contentType,
          );
          continue;
        }
        const results: UploadLookupResult[] = await res.json();
        for (const item of results) {
          map.set(item.short_url, item.url);
        }
      } else {
        console.warn('[DXP] /uploads/lookup-urls HTTP', res.status);
      }
    } catch (err) {
      console.warn('[DXP] /uploads/lookup-urls failed:', err);
    }
  }
  return map;
}

/** Fetch category name by ID. Falls back to DOM extraction. */
export async function fetchCategoryName(categoryId: number): Promise<string> {
  // Try DOM first — select LAST breadcrumb item (handles subcategories)
  const breadcrumbs = document.querySelectorAll(
    '.category-breadcrumb .badge-category__name',
  );
  const lastBreadcrumb = breadcrumbs[breadcrumbs.length - 1];
  if (lastBreadcrumb?.textContent) return lastBreadcrumb.textContent.trim();

  // Fallback: /site.json contains ALL categories including subcategories
  try {
    const res = await fetch('/site.json');
    if (res.ok) {
      const data = await res.json();
      const cat = (
        data.categories as { id: number; name: string }[] | undefined
      )?.find((c) => c.id === categoryId);
      if (cat) return cat.name;
    }
  } catch {
    // ignore
  }
  return `category-${categoryId}`;
}

/** Fetch binary data with timeout (for image downloads) */
export async function fetchBinary(
  url: string,
  timeoutMs = 60000,
): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    return new Uint8Array(buffer);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ==================== Helpers ====================

async function fetchWithRetry(url: string, attempts = 2): Promise<Response> {
  let lastStatus = 0;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res;

    lastStatus = res.status;
    if (attempt < attempts && (res.status === 429 || res.status >= 500)) {
      await sleepRandom(500, 1200);
      continue;
    }
    throw new Error(`Failed to fetch posts: HTTP ${res.status}`);
  }

  throw new Error(`Failed to fetch posts: HTTP ${lastStatus}`);
}
