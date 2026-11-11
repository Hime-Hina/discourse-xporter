import type { MonkeyWindow } from 'vite-plugin-monkey/dist/client';
import type { ExportProfile } from '../types';
import { parseExportProfile } from '../core/export-profile';
import { copyActiveBytesToArrayBuffer } from '../utils/binary';
import { retryDelayMs, sleep } from '../utils/timing';
import { normalizeOrigin, sourceIdentity } from './paths';

declare const GM_xmlhttpRequest: MonkeyWindow['GM_xmlhttpRequest'];

export interface ObsidianApiConfig {
  apiUrl: string;
  apiKey: string;
}

interface GmResponse {
  status: number;
  responseText: string;
  responseHeaders?: string;
  response?: unknown;
}

export class ObsidianApiError extends Error {
  constructor(
    public readonly status: number,
    operation: string,
  ) {
    super(`Obsidian API ${operation} failed: HTTP ${status}`);
    this.name = 'ObsidianApiError';
  }
}

export class UncertainWriteError extends Error {
  constructor(reason: string) {
    super(
      `Obsidian PUT result is uncertain (${reason}); verify the target before retrying`,
    );
    this.name = 'UncertainWriteError';
  }
}

function makeHeaders(
  apiKey: string,
  contentType = 'text/markdown',
): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': contentType };
}

function apiUrl(cfg: ObsidianApiConfig, path: string): string {
  let base: URL;
  try {
    base = new URL(cfg.apiUrl);
  } catch {
    throw new Error('Invalid Obsidian API URL');
  }
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(
    base.hostname.toLowerCase(),
  );
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    !local ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/'
  ) {
    throw new Error(
      'Obsidian API URL must point to localhost without a path or credentials',
    );
  }
  return `${base.origin}${path}`;
}

function requestOnce(
  options: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    data?: string | ArrayBuffer;
    responseType?: 'text' | 'arraybuffer';
  },
  signal?: AbortSignal,
): Promise<GmResponse> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    let handle: { abort(): void } | undefined;
    const finish = (error?: Error, response?: GmResponse): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else if (response) resolve(response);
    };
    const fail = (reason: string, aborted = false): void => {
      if (settled) return;
      const error =
        options.method === 'PUT'
          ? new UncertainWriteError(reason)
          : aborted
            ? new DOMException(reason, 'AbortError')
            : new Error(`Obsidian request ${reason}`);
      finish(error);
      handle?.abort();
    };
    const onAbort = (): void => fail('cancelled', true);
    // Fetch-backed GM requests can ignore the native timeout; the owner also enforces a deadline.
    const timer = setTimeout(() => fail('timed out'), 60_000);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      handle = GM_xmlhttpRequest({
        ...options,
        timeout: 60_000,
        redirect: 'error',
        onload: (response) => finish(undefined, response),
        onerror: () => fail('network error'),
        ontimeout: () => fail('timed out'),
        onabort: () => fail('cancelled', true),
      });
    } catch {
      fail('dispatch failed');
    }
  });
}

async function gmRequest(
  options: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    data?: string | ArrayBuffer;
    responseType?: 'text' | 'arraybuffer';
  },
  signal?: AbortSignal,
  retryRead = false,
): Promise<GmResponse> {
  const attempts = retryRead ? 2 : 1;
  for (let attempt = 1; ; attempt++) {
    let response: GmResponse;
    try {
      response = await requestOnce(options, signal);
    } catch (error) {
      if (
        signal?.aborted ||
        attempt >= attempts ||
        (error instanceof DOMException && error.name === 'AbortError')
      )
        throw error;
      await sleep(retryDelayMs(null, attempt), signal);
      continue;
    }
    if (
      attempt >= attempts ||
      (response.status !== 429 && response.status < 500)
    )
      return response;
    const retryAfter =
      response.responseHeaders?.match(/^retry-after:\s*(.+)$/im)?.[1]?.trim() ??
      null;
    await sleep(retryDelayMs(retryAfter, attempt), signal);
  }
}

function encodePath(path: string): string {
  if (
    !path ||
    path.startsWith('/') ||
    /[\\\u0000-\u001f]/.test(path) ||
    path
      .split('/')
      .some((segment) => segment === '.' || segment === '..' || !segment)
  )
    throw new Error('Invalid vault path');
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function assertSuccess(response: GmResponse, operation: string): void {
  if (response.status < 200 || response.status >= 300)
    throw new ObsidianApiError(response.status, operation);
}

export async function testConnection(
  cfg: ObsidianApiConfig,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const response = await gmRequest(
      {
        method: 'GET',
        url: apiUrl(cfg, '/'),
        headers: makeHeaders(cfg.apiKey),
      },
      signal,
      true,
    );
    return response.status === 200;
  } catch (error) {
    if (signal?.aborted) throw error;
    return false;
  }
}

async function searchNotes(
  cfg: ObsidianApiConfig,
  query: unknown,
  signal?: AbortSignal,
): Promise<string[]> {
  const response = await gmRequest(
    {
      method: 'POST',
      url: apiUrl(cfg, '/search/'),
      headers: makeHeaders(cfg.apiKey, 'application/vnd.olrapi.jsonlogic+json'),
      data: JSON.stringify(query),
    },
    signal,
    true,
  );
  assertSuccess(response, 'search');
  const records: unknown = JSON.parse(response.responseText);
  if (
    !Array.isArray(records) ||
    records.some(
      (record) => !isObject(record) || typeof record.filename !== 'string',
    )
  ) {
    throw new Error('Obsidian API search returned invalid results');
  }
  return [...new Set(records.map((record) => String(record.filename)))];
}

export async function searchByOrigin(
  cfg: ObsidianApiConfig,
  origin: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const normalized = normalizeOrigin(origin);
  return searchNotes(
    cfg,
    {
      and: [
        { glob: [`${normalized}/*`, { var: 'frontmatter.source' }] },
        { '!!': [{ var: 'frontmatter.topic_id' }] },
      ],
    },
    signal,
  );
}

export async function searchByTopic(
  cfg: ObsidianApiConfig,
  origin: string,
  topicId: number,
  signal?: AbortSignal,
): Promise<string[]> {
  const normalized = normalizeOrigin(origin);
  return searchNotes(
    cfg,
    {
      and: [
        { glob: [`${normalized}/*`, { var: 'frontmatter.source' }] },
        { '==': [{ var: 'frontmatter.topic_id' }, topicId] },
      ],
    },
    signal,
  );
}

export async function searchOutdatedByTopicId(
  cfg: ObsidianApiConfig,
  topicId: number,
  formatVersion: number,
  origin: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const paths = await searchByTopic(cfg, origin, topicId, signal);
    for (const path of paths) {
      const note = await getNoteMetadata(cfg, path, signal);
      if (
        note &&
        sourceIdentity(note.source, note.topicId).origin ===
          normalizeOrigin(origin) &&
        note.topicId === topicId &&
        note.xporterVersion < formatVersion
      )
        return true;
    }
    return false;
  } catch {
    return false;
  }
}

export interface VaultNote {
  content: string;
  frontmatter: Record<string, unknown>;
}

export async function readVaultNote(
  cfg: ObsidianApiConfig,
  path: string,
  signal?: AbortSignal,
): Promise<VaultNote | null> {
  const response = await gmRequest(
    {
      method: 'GET',
      url: apiUrl(cfg, `/vault/${encodePath(path)}`),
      headers: {
        ...makeHeaders(cfg.apiKey),
        Accept: 'application/vnd.olrapi.note+json',
      },
    },
    signal,
    true,
  );
  if (response.status === 404) return null;
  assertSuccess(response, 'read');
  const note: unknown = JSON.parse(response.responseText);
  if (
    !isObject(note) ||
    typeof note.content !== 'string' ||
    !isObject(note.frontmatter)
  )
    throw new Error(`Invalid Obsidian note response: ${path}`);
  return { content: note.content, frontmatter: note.frontmatter };
}

export interface NoteMetadata {
  path: string;
  title: string;
  topicId: number;
  source: string;
  xporterVersion: number;
  exportProfile?: ExportProfile;
  content: string;
}

export function noteMetadata(
  path: string,
  note: VaultNote,
): NoteMetadata | null {
  const fm = note.frontmatter;
  if (fm.topic_id === undefined && fm.source === undefined) return null;
  if (
    typeof fm.topic_id !== 'number' ||
    !Number.isSafeInteger(fm.topic_id) ||
    fm.topic_id < 1 ||
    typeof fm.source !== 'string'
  )
    throw new Error(`Invalid export metadata: ${path}`);
  sourceIdentity(fm.source, fm.topic_id);
  const version = fm.xporter_version === undefined ? 0 : fm.xporter_version;
  if (
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version < 0
  )
    throw new Error(`Invalid export version: ${path}`);
  return {
    path,
    title: typeof fm.title === 'string' ? fm.title : path,
    topicId: fm.topic_id,
    source: fm.source,
    xporterVersion: version,
    exportProfile: parseExportProfile(fm.export_profile),
    content: note.content,
  };
}

export async function getNoteMetadata(
  cfg: ObsidianApiConfig,
  path: string,
  signal?: AbortSignal,
): Promise<NoteMetadata | null> {
  const note = await readVaultNote(cfg, path, signal);
  return note ? noteMetadata(path, note) : null;
}

export async function writeNote(
  cfg: ObsidianApiConfig,
  path: string,
  content: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await gmRequest(
    {
      method: 'PUT',
      url: apiUrl(cfg, `/vault/${encodePath(path)}`),
      headers: makeHeaders(cfg.apiKey),
      data: content,
    },
    signal,
  );
  assertSuccess(response, 'write');
}

/** Only a successful GET of the actual bytes permits an immutable attachment write to be skipped. */
export async function readBinary(
  cfg: ObsidianApiConfig,
  path: string,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  const response = await gmRequest(
    {
      method: 'GET',
      url: apiUrl(cfg, `/vault/${encodePath(path)}`),
      headers: makeHeaders(cfg.apiKey, 'application/octet-stream'),
      responseType: 'arraybuffer',
    },
    signal,
    true,
  );
  if (response.status === 404) return null;
  assertSuccess(response, 'binary read');
  if (!(response.response instanceof ArrayBuffer))
    throw new Error('Invalid Obsidian binary response');
  return new Uint8Array(response.response);
}

export async function writeBinary(
  cfg: ObsidianApiConfig,
  path: string,
  bytes: Uint8Array,
  mimeType: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await gmRequest(
    {
      method: 'PUT',
      url: apiUrl(cfg, `/vault/${encodePath(path)}`),
      headers: makeHeaders(cfg.apiKey, mimeType),
      data: copyActiveBytesToArrayBuffer(bytes),
    },
    signal,
  );
  assertSuccess(response, 'binary write');
}

export async function openNote(
  cfg: ObsidianApiConfig,
  path: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await gmRequest(
    {
      method: 'POST',
      url: apiUrl(cfg, `/open/${encodePath(path)}?newLeaf=true`),
      headers: makeHeaders(cfg.apiKey),
    },
    signal,
  );
  assertSuccess(response, 'open');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
