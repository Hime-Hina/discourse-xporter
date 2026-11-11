// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS } from '../src/config/defaults';
import { buildExportProfile } from '../src/core/export-profile';
import type {
  BatchItem,
  DiscoursePost,
  DiscourseTopic,
  ExportProfile,
  FilterConfig,
} from '../src/types';

const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>(
  'node:crypto',
);

interface StoredNote {
  content: string;
  frontmatter: Record<string, unknown>;
}
interface GmRequest {
  method: string;
  url: string;
  data?: string | ArrayBuffer;
  responseType?: string;
  onload: (response: {
    status: number;
    responseText: string;
    response?: ArrayBuffer;
  }) => void;
}

const origin = 'https://batch-contract.example';
const connection = {
  apiUrl: 'https://127.0.0.1:27124',
  apiKey: 'SYNTHETIC_BATCH_KEY',
};
const sourceReads: { url: string; bytes: number }[] = [];
const writes: { path: string; content: string | ArrayBuffer }[] = [];
const notes = new Map<string, StoredNote>();
const binaries = new Map<string, ArrayBuffer>();
let topics: Map<number, { topic: DiscourseTopic; posts: DiscoursePost[] }>;
let profileA: ExportProfile;
let profileB: ExportProfile;
let unreadableMetadata:
  | { path: string; status: number; body: string }
  | undefined;

function post(
  topicId: number,
  id: number,
  postNumber: number,
  username: string,
  content: string,
): DiscoursePost {
  return {
    id,
    post_number: postNumber,
    topic_id: topicId,
    topic_slug: 'fixture',
    post_type: 1,
    username,
    name: username,
    avatar_template: '/avatar/{size}.png',
    user_id: username === 'alice' ? 1 : 2,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    raw: content,
    cooked: `<p>${content}</p>`,
    reply_count: 0,
    reply_to_post_number: null,
    quote_count: 0,
    reads: 0,
    score: 0,
    display_username: username,
    version: 1,
    trust_level: 1,
    moderator: false,
    admin: false,
    staff: false,
    hidden: false,
    deleted_at: null,
    wiki: false,
    user_title: null,
    post_url: `/t/fixture/${topicId}/${postNumber}`,
  };
}

function topic(
  id: number,
  categoryId: number,
  posts: DiscoursePost[],
): DiscourseTopic {
  const creator = {
    id: 1,
    username: 'alice',
    name: 'Alice',
    avatar_template: '/avatar/{size}.png',
  };
  return {
    id,
    title: 'Same Title',
    fancy_title: 'Same Title',
    slug: 'fixture',
    category_id: categoryId,
    tags: [],
    posts_count: posts.length,
    created_at: '2026-01-01T00:00:00.000Z',
    views: 10,
    reply_count: posts.length - 1,
    like_count: 0,
    word_count: 20,
    user_id: 1,
    highest_post_number: posts[posts.length - 1].post_number,
    participant_count: 2,
    visible: true,
    closed: false,
    archived: false,
    image_url: null,
    post_stream: { posts: [posts[0]], stream: posts.map((entry) => entry.id) },
    details: { participants: [], created_by: creator, last_poster: creator },
  };
}

function savedNote(topicId: number, profile: ExportProfile): StoredNote {
  return {
    content: `old document ${topicId}`,
    frontmatter: {
      source: `${origin}/t/topic/${topicId}`,
      topic_id: topicId,
      title: 'Same Title',
      xporter_version: 1,
      export_profile: profile,
    },
  };
}

function parseSavedFrontmatter(content: string): Record<string, unknown> {
  const frontmatter: Record<string, unknown> = {};
  const header = content.split('\n---\n', 1)[0];
  for (const key of [
    'source',
    'title',
    'export_profile',
    'topic_id',
    'xporter_version',
  ]) {
    const raw = header.match(new RegExp(`^${key}: (.+)$`, 'm'))?.[1];
    if (raw !== undefined) frontmatter[key] = JSON.parse(raw);
  }
  return frontmatter;
}

function response(payload: unknown, url: string): Response {
  const body = JSON.stringify(payload);
  sourceReads.push({ url, bytes: new TextEncoder().encode(body).length });
  return new Response(body, {
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-11T00:00:00Z'));
  vi.stubGlobal('crypto', webcrypto);
  sourceReads.length = 0;
  writes.length = 0;
  notes.clear();
  binaries.clear();
  unreadableMetadata = undefined;
  const postsA = [
    post(101, 710, 1, 'alice', 'excluded first A'),
    post(
      101,
      809,
      4,
      'alice',
      'kept A ![A image](https://cdn.batch.example/a.png)',
    ),
    post(101, 877, 7, 'bob', 'excluded different author A'),
    post(101, 1221, 12, 'alice', 'excluded outside range A'),
  ];
  const postsB = [
    post(202, 2040, 1, 'alice', 'excluded first B'),
    post(
      202,
      9001,
      9,
      'bob',
      'kept B ![B image](https://cdn.batch.example/b.png)',
    ),
    post(202, 9900, 14, 'bob', 'excluded unselected B'),
  ];
  topics = new Map([
    [101, { topic: topic(101, 31, postsA), posts: postsA }],
    [202, { topic: topic(202, 42, postsB), posts: postsB }],
  ]);
  const filters: FilterConfig = {
    rangeMode: 'range',
    rangeStart: 4,
    rangeEnd: 10,
    onlyOp: false,
    imgFilter: 'none',
    users: ['ALIce'],
    includeKeywords: [],
    excludeKeywords: [],
    minLength: 0,
  };
  profileA = buildExportProfile(
    {
      ...DEFAULTS,
      imgMode: 'none',
      floorTemplate:
        'A TEMPLATE #{{post_number}} {{block_ref}}\n\n{{content}}\n',
    },
    filters,
  );
  profileB = buildExportProfile(
    {
      ...DEFAULTS,
      imgMode: 'file',
      floorTemplate:
        'B TEMPLATE #{{post_number}} {{block_ref}}\n\n{{content}}\n',
    },
    {
      ...filters,
      rangeMode: 'selected',
      rangeStart: 1,
      rangeEnd: Infinity,
      users: ['bob'],
    },
    new Map([[9, 9001]]),
    new Set([9]),
  );
  notes.set('Archive/a-original.md', savedNote(101, profileA));
  notes.set('Other/b-original.md', savedNote(202, profileB));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
        origin,
      );
      if (url.origin === 'https://cdn.batch.example') {
        const bytes = new Uint8Array([137, 80, 78, 71]);
        sourceReads.push({ url: url.href, bytes: bytes.length });
        return new Response(bytes, {
          headers: { 'Content-Type': 'image/png' },
        });
      }
      if (url.pathname === '/site.json')
        return response(
          {
            categories: [
              { id: 31, name: 'Category A' },
              { id: 42, name: 'Category B' },
            ],
          },
          url.href,
        );
      const match = url.pathname.match(
        /^\/t\/(\d+)(?:\.json|\/(post_ids|posts)\.json)$/,
      );
      if (!match) throw new Error(`Unexpected source request: ${url.href}`);
      const entry = topics.get(Number(match[1]));
      if (!entry) throw new Error(`Unknown topic: ${url.href}`);
      if (!match[2]) return response(entry.topic, url.href);
      if (match[2] === 'post_ids') {
        const users = url.searchParams
          .get('username_filters')
          ?.toLowerCase()
          .split(',');
        const candidates = users?.length
          ? entry.posts.filter((post) =>
              users.includes(post.username.toLowerCase()),
            )
          : entry.posts;
        return response(
          {
            post_ids: candidates
              .filter((post) => post.post_number !== 1)
              .map((post) => post.id),
          },
          url.href,
        );
      }
      const ids = new Set(url.searchParams.getAll('post_ids[]').map(Number));
      return response(
        {
          post_stream: {
            posts: entry.posts.filter((post) => ids.has(post.id)),
          },
        },
        url.href,
      );
    }),
  );
  vi.stubGlobal('GM_xmlhttpRequest', (request: GmRequest) => {
    const url = new URL(request.url);
    if (url.hostname !== '127.0.0.1')
      throw new Error('Connection secret would leave localhost');
    if (url.pathname === '/search/') {
      request.onload({
        status: 200,
        responseText: JSON.stringify(
          [...notes.keys()].map((filename) => ({ filename })),
        ),
      });
    } else if (url.pathname.startsWith('/vault/')) {
      const path = decodeURIComponent(url.pathname.slice('/vault/'.length));
      if (request.method === 'GET') {
        if (unreadableMetadata?.path === path) {
          request.onload({
            status: unreadableMetadata.status,
            responseText: unreadableMetadata.body,
          });
          return { abort() {} };
        }
        const value =
          request.responseType === 'arraybuffer'
            ? binaries.get(path)
            : notes.get(path);
        request.onload({
          status: value ? 200 : 404,
          responseText:
            typeof value === 'object' && !(value instanceof ArrayBuffer)
              ? JSON.stringify(value)
              : '',
          response: value instanceof ArrayBuffer ? value : undefined,
        });
      } else if (request.method === 'PUT' && request.data !== undefined) {
        writes.push({ path, content: request.data });
        if (typeof request.data === 'string')
          notes.set(path, {
            content: request.data,
            frontmatter: parseSavedFrontmatter(request.data),
          });
        else binaries.set(path, request.data);
        request.onload({ status: 204, responseText: '' });
      } else throw new Error(`Unexpected vault operation: ${request.method}`);
    } else throw new Error(`Unexpected GM request: ${request.url}`);
    return { abort() {} };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function run(items: BatchItem[], version = 2, signal?: AbortSignal) {
  const { reExportObsidianNotes } =
    await import('../src/export/obsidian-batch');
  return reExportObsidianNotes({
    items,
    config: {
      ...DEFAULTS,
      imgMode: 'embed',
      floorTemplate: 'CURRENT GLOBAL TEMPLATE {{content}}',
      batchDelayMin: 0,
      batchDelayMax: 0,
      imageDelayMin: 0,
      imageDelayMax: 0,
    },
    apiConfig: connection,
    origin,
    forumName: 'Fixture Forum',
    formatVersion: version,
    onProgress: () => {},
    signal,
  });
}

describe('batch source-to-vault contract', () => {
  it('treats a GM-read DOMException cancellation as cancelled without a failed write', async () => {
    const { scanExportedNotesByOrigin } =
      await import('../src/export/obsidian-batch');
    const items = await scanExportedNotesByOrigin(connection, origin);
    const controller = new AbortController();
    vi.stubGlobal('GM_xmlhttpRequest', () => {
      controller.abort();
      return { abort() {} };
    });
    expect(await run(items, 2, controller.signal)).toMatchObject({
      success: 0,
      failed: 0,
      cancelled: true,
    });
    expect(writes).toEqual([]);
  });

  it.each([
    { status: 401, body: '' },
    { status: 200, body: 'invalid JSON' },
  ])(
    'exposes an unreadable note instead of reporting an empty successful scan: %o',
    async (failure) => {
      const { scanExportedNotesByOrigin } =
        await import('../src/export/obsidian-batch');
      unreadableMetadata = { path: 'Archive/a-original.md', ...failure };
      await expect(
        scanExportedNotesByOrigin(connection, origin),
      ).rejects.toThrow('Archive/a-original.md');
      expect(writes).toEqual([]);
      expect(sourceReads).toEqual([]);
    },
  );

  it('restores two distinct policies through real acquisition, conversion, attachment materialization, and original-path writes', async () => {
    const { scanExportedNotesByOrigin } =
      await import('../src/export/obsidian-batch');
    const items = await scanExportedNotesByOrigin(connection, origin);
    expect(await run(items)).toMatchObject({
      updated: 2,
      unchanged: 0,
      failed: 0,
    });
    const first = notes.get('Archive/a-original.md')!;
    const second = notes.get('Other/b-original.md')!;
    expect(first.content).toContain('A TEMPLATE #4 ^floor-4');
    expect(first.content).toContain('kept A A image');
    expect(first.content).not.toContain('![A image]');
    expect(first.content).toContain('category: "Category A"');
    expect(second.content).toContain('B TEMPLATE #9 ^floor-9');
    expect(second.content).toContain('category: "Category B"');
    expect(second.content).toMatch(
      /!\[\[Discourse\/attachments\/https--batch-contract\.example\/202\/[a-f0-9]{64}\.png\|B image\]\]/,
    );
    for (const note of [first, second]) {
      expect(note.content).not.toContain('excluded');
      expect(note.content).not.toContain('CURRENT GLOBAL TEMPLATE');
      expect(note.content).not.toContain(connection.apiKey);
      expect(note.frontmatter.export_profile).toEqual(
        note === first ? profileA : profileB,
      );
    }
    const selectedRead = sourceReads.filter((entry) =>
      entry.url.includes('/t/202/posts.json'),
    );
    expect(selectedRead).toHaveLength(1);
    expect(
      new URL(selectedRead[0].url).searchParams.getAll('post_ids[]'),
    ).toEqual(['9001']);
    expect(
      sourceReads
        .filter((entry) => entry.url.startsWith('https://cdn.'))
        .map((entry) => entry.url),
    ).toEqual(['https://cdn.batch.example/b.png']);
    expect(
      writes
        .filter((entry) => typeof entry.content === 'string')
        .map((entry) => entry.path),
    ).toEqual(['Archive/a-original.md', 'Other/b-original.md']);
    expect(
      writes.filter((entry) => entry.content instanceof ArrayBuffer),
    ).toHaveLength(1);
  });

  it('skips identical writes after verifying full source content and existing attachment bytes, but detects old-post edits and format changes', async () => {
    const { scanExportedNotesByOrigin } =
      await import('../src/export/obsidian-batch');
    const initial = await scanExportedNotesByOrigin(connection, origin);
    expect((await run(initial)).updated).toBe(2);
    const baseline = {
      reads: sourceReads.length,
      bytes: sourceReads.reduce((sum, entry) => sum + entry.bytes, 0),
      puts: writes.length,
    };
    expect(baseline.reads).toBe(7);
    expect(baseline.bytes).toBeGreaterThan(0);
    expect(baseline.puts).toBe(3);
    writes.length = 0;
    sourceReads.length = 0;
    vi.setSystemTime(new Date('2026-11-12T00:00:00Z'));
    expect(
      await run(await scanExportedNotesByOrigin(connection, origin)),
    ).toMatchObject({ updated: 0, unchanged: 2, failed: 0 });
    expect(sourceReads).toHaveLength(6);
    expect(
      sourceReads
        .filter((entry) => entry.url.startsWith('https://cdn.'))
        .reduce((sum, entry) => sum + entry.bytes, 0),
    ).toBe(4);
    expect(writes).toEqual([]);
    topics.get(101)!.posts.find((entry) => entry.post_number === 4)!.raw +=
      ' EDITED OLD POST';
    expect(
      await run(await scanExportedNotesByOrigin(connection, origin)),
    ).toMatchObject({ updated: 1, unchanged: 1, failed: 0 });
    expect(notes.get('Archive/a-original.md')!.content).toContain(
      'EDITED OLD POST',
    );
    expect(writes).toHaveLength(1);
    writes.length = 0;
    expect(
      await run(await scanExportedNotesByOrigin(connection, origin), 3),
    ).toMatchObject({ updated: 2, unchanged: 0, failed: 0 });
    expect(writes).toHaveLength(2);
  });
});
