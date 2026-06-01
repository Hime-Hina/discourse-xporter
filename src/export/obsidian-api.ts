import { copyActiveBytesToArrayBuffer } from '../utils/binary';

declare function GM_xmlhttpRequest(details: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  data?: string | ArrayBuffer;
  responseType?: string;
  onload: (response: { status: number; responseText: string }) => void;
  onerror: (error: unknown) => void;
}): void;

export interface ObsidianApiConfig {
  apiUrl: string;
  apiKey: string;
}

function makeHeaders(
  apiKey: string,
  contentType = 'text/markdown',
): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': contentType,
  };
}

function apiUrl(cfg: ObsidianApiConfig, path: string): string {
  const base = normalizeApiBase(cfg.apiUrl);
  assertLocalApiUrl(base);
  return `${base}${path}`;
}

function normalizeApiBase(url: string): string {
  return url.replace(/\/+$/, '');
}

function assertLocalApiUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid Obsidian API URL');
  }

  const host = parsed.hostname.toLowerCase();
  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]';

  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !isLocal) {
    throw new Error('Obsidian API URL must point to localhost');
  }
}

/** Promisified GM_xmlhttpRequest */
function gmRequest(options: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  data?: string | ArrayBuffer;
}): Promise<{ status: number; responseText: string }> {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      ...options,
      onload: resolve,
      onerror: reject,
    });
  });
}

/** Encode a vault path for use in API URL */
function encodePath(path: string): string {
  return path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

/** Test connection to Obsidian Local REST API */
export async function testConnection(cfg: ObsidianApiConfig): Promise<boolean> {
  try {
    const res = await gmRequest({
      method: 'GET',
      url: apiUrl(cfg, '/'),
      headers: makeHeaders(cfg.apiKey),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

/** Search for outdated note by topic_id (version < formatVersion or missing) */
export async function searchOutdatedByTopicId(
  cfg: ObsidianApiConfig,
  topicId: number,
  formatVersion: number,
): Promise<boolean> {
  try {
    const res = await gmRequest({
      method: 'POST',
      url: apiUrl(cfg, '/search/'),
      headers: makeHeaders(cfg.apiKey, 'application/vnd.olrapi.jsonlogic+json'),
      data: JSON.stringify({
        and: [
          { '==': [{ var: 'frontmatter.topic_id' }, topicId] },
          {
            or: [
              { '!': [{ var: 'frontmatter.xporter_version' }] },
              { '<': [{ var: 'frontmatter.xporter_version' }, formatVersion] },
            ],
          },
        ],
      }),
    });
    if (res.status === 200) {
      const results = JSON.parse(res.responseText);
      return Array.isArray(results) && results.length > 0;
    }
  } catch {
    // ignore
  }
  return false;
}

/** Search all exported notes from a given origin */
export async function searchByOrigin(
  cfg: ObsidianApiConfig,
  origin: string,
): Promise<string[]> {
  const res = await gmRequest({
    method: 'POST',
    url: apiUrl(cfg, '/search/'),
    headers: makeHeaders(cfg.apiKey, 'application/vnd.olrapi.jsonlogic+json'),
    data: JSON.stringify({
      and: [
        { glob: [`${origin}/*`, { var: 'frontmatter.source' }] },
        { '!!': [{ var: 'frontmatter.topic_id' }] },
      ],
    }),
  });

  if (res.status !== 200) {
    throw new Error(`Obsidian API search failed: HTTP ${res.status}`);
  }

  const results: unknown = JSON.parse(res.responseText);
  if (!Array.isArray(results)) {
    throw new Error('Obsidian API search returned invalid results');
  }

  return results
    .map((entry: unknown) =>
      typeof entry === 'object' && entry !== null && 'filename' in entry
        ? (entry as { filename?: unknown }).filename
        : null,
    )
    .filter((filename): filename is string => typeof filename === 'string');
}

export interface NoteMetadata {
  path: string;
  title: string;
  topicId: number;
  xporterVersion: number;
}

/** Get frontmatter metadata from a note */
export async function getNoteMetadata(
  cfg: ObsidianApiConfig,
  path: string,
): Promise<NoteMetadata | null> {
  try {
    const res = await gmRequest({
      method: 'GET',
      url: apiUrl(cfg, `/vault/${encodePath(path)}`),
      headers: {
        ...makeHeaders(cfg.apiKey),
        Accept: 'application/vnd.olrapi.note+json',
      },
    });
    if (res.status === 200) {
      const data = JSON.parse(res.responseText);
      const fm = data.frontmatter;
      if (fm?.topic_id) {
        return {
          path,
          title: fm.title ?? path,
          topicId: Number(fm.topic_id),
          xporterVersion: Number(fm.xporter_version) || 0,
        };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/** Write a note (full overwrite) */
export async function writeNote(
  cfg: ObsidianApiConfig,
  path: string,
  content: string,
): Promise<void> {
  const res = await gmRequest({
    method: 'PUT',
    url: apiUrl(cfg, `/vault/${encodePath(path)}`),
    headers: makeHeaders(cfg.apiKey),
    data: content,
  });
  if (res.status !== 204 && res.status !== 200) {
    throw new Error(`Obsidian API write failed: HTTP ${res.status}`);
  }
}

/** Write a binary file (image / attachment) */
export async function writeBinary(
  cfg: ObsidianApiConfig,
  path: string,
  data: Uint8Array,
  mimeType: string,
): Promise<void> {
  const res = await gmRequest({
    method: 'PUT',
    url: apiUrl(cfg, `/vault/${encodePath(path)}`),
    headers: makeHeaders(cfg.apiKey, mimeType),
    data: copyActiveBytesToArrayBuffer(data),
  });
  if (res.status !== 204 && res.status !== 200) {
    throw new Error(`Obsidian API binary write failed: HTTP ${res.status}`);
  }
}

/** Open a note in Obsidian */
export async function openNote(
  cfg: ObsidianApiConfig,
  path: string,
): Promise<void> {
  const res = await gmRequest({
    method: 'POST',
    url: apiUrl(cfg, `/open/${encodePath(path)}?newLeaf=true`),
    headers: makeHeaders(cfg.apiKey),
  });
  if (res.status !== 200 && res.status !== 204) {
    throw new Error(`Obsidian API open failed: HTTP ${res.status}`);
  }
}
