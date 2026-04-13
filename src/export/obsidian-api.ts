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
      url: `${cfg.apiUrl}/`,
      headers: makeHeaders(cfg.apiKey),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

/** Check if a note already exists */
export async function noteExists(
  cfg: ObsidianApiConfig,
  path: string,
): Promise<boolean> {
  try {
    const res = await gmRequest({
      method: 'GET',
      url: `${cfg.apiUrl}/vault/${encodePath(path)}`,
      headers: {
        ...makeHeaders(cfg.apiKey),
        Accept: 'application/vnd.olrapi.note+json',
      },
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

/** Search for existing note by topic_id */
export async function searchByTopicId(
  cfg: ObsidianApiConfig,
  topicId: number,
): Promise<string | null> {
  try {
    const res = await gmRequest({
      method: 'POST',
      url: `${cfg.apiUrl}/search/`,
      headers: makeHeaders(cfg.apiKey, 'application/vnd.olrapi.jsonlogic+json'),
      data: JSON.stringify({
        '==': [{ var: 'frontmatter.discourse.topic_id' }, topicId],
      }),
    });
    if (res.status === 200) {
      const results = JSON.parse(res.responseText);
      if (Array.isArray(results) && results.length > 0) {
        return results[0].filename;
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
    url: `${cfg.apiUrl}/vault/${encodePath(path)}`,
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
    url: `${cfg.apiUrl}/vault/${encodePath(path)}`,
    headers: makeHeaders(cfg.apiKey, mimeType),
    data: data.buffer as ArrayBuffer,
  });
  if (res.status !== 204 && res.status !== 200) {
    throw new Error(`Obsidian API binary write failed: HTTP ${res.status}`);
  }
}

/** Append content to existing note via PATCH */
export async function appendToNote(
  cfg: ObsidianApiConfig,
  path: string,
  content: string,
): Promise<void> {
  const res = await gmRequest({
    method: 'PATCH',
    url: `${cfg.apiUrl}/vault/${encodePath(path)}`,
    headers: {
      ...makeHeaders(cfg.apiKey),
      Operation: 'append',
    },
    data: content,
  });
  if (res.status !== 200) {
    throw new Error(`Obsidian API append failed: HTTP ${res.status}`);
  }
}

/** Open a note in Obsidian */
export async function openNote(
  cfg: ObsidianApiConfig,
  path: string,
): Promise<void> {
  await gmRequest({
    method: 'POST',
    url: `${cfg.apiUrl}/open/${encodePath(path)}?newLeaf=true`,
    headers: makeHeaders(cfg.apiKey),
  });
}
