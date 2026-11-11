import { vi } from 'vitest';

export interface VaultRequest {
  method: string;
  url: string;
  data?: string | ArrayBuffer;
  responseType?: string;
  headers?: Record<string, string>;
  timeout?: number;
  redirect?: string;
  onload: (response: {
    status: number;
    responseText: string;
    response?: ArrayBuffer;
    responseHeaders?: string;
  }) => void;
  onerror: () => void;
  ontimeout: () => void;
  onabort: () => void;
}

export function frontmatter(content: string): Record<string, unknown> {
  const fm: Record<string, unknown> = {};
  const header = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  for (const line of header.split('\n')) {
    const match = line.match(/^([a-z_]+): (.*)$/);
    if (!match) continue;
    try {
      fm[match[1]] = JSON.parse(match[2]);
    } catch {
      fm[match[1]] = match[2];
    }
  }
  return fm;
}

function evaluate(query: unknown, fm: Record<string, unknown>): unknown {
  if (query === null || typeof query !== 'object') return query;
  if (Array.isArray(query)) return query.map((item) => evaluate(item, fm));
  const entries = Object.entries(query);
  const [operator, args] = entries[0];
  if (operator === 'var') return fm[String(args).replace('frontmatter.', '')];
  const values = Array.isArray(args)
    ? args.map((value) => evaluate(value, fm))
    : [evaluate(args, fm)];
  if (operator === 'and') return values.every(Boolean);
  if (operator === '==') return values[0] === values[1];
  if (operator === '!!') return !!values[0];
  if (operator === 'glob')
    return String(values[1]).startsWith(String(values[0]).replace(/\*$/, ''));
  throw new Error(`Unexpected query operator: ${operator}`);
}

export function installMemoryVault(
  initial: Record<string, string | Uint8Array> = {},
) {
  const files = new Map<string, string | Uint8Array>(Object.entries(initial));
  const requests: VaultRequest[] = [];
  const override: { handle?: (request: VaultRequest) => boolean } = {};
  vi.stubGlobal('GM_xmlhttpRequest', (request: VaultRequest) => {
    requests.push(request);
    if (override.handle?.(request)) return { abort: () => request.onabort() };
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname.replace(/^\/vault\//, ''));
    if (url.pathname === '/')
      request.onload({ status: 200, responseText: '{}' });
    else if (url.pathname === '/search/') {
      const query: unknown = JSON.parse(String(request.data));
      const matches = [...files].filter(
        ([, content]) =>
          typeof content === 'string' && evaluate(query, frontmatter(content)),
      );
      request.onload({
        status: 200,
        responseText: JSON.stringify(
          matches.map(([filename]) => ({ filename })),
        ),
      });
    } else if (request.method === 'PUT') {
      if (typeof request.data === 'string') files.set(path, request.data);
      else if (request.data instanceof ArrayBuffer)
        files.set(path, new Uint8Array(request.data));
      request.onload({ status: 204, responseText: '' });
    } else if (url.pathname.startsWith('/open/'))
      request.onload({ status: 200, responseText: '' });
    else {
      const content = files.get(path);
      if (content === undefined)
        request.onload({ status: 404, responseText: '' });
      else if (
        request.responseType === 'arraybuffer' &&
        content instanceof Uint8Array
      )
        request.onload({
          status: 200,
          responseText: '',
          response: new Uint8Array(content).buffer,
        });
      else if (typeof content === 'string')
        request.onload({
          status: 200,
          responseText: JSON.stringify({
            content,
            frontmatter: frontmatter(content),
          }),
        });
      else request.onload({ status: 400, responseText: '' });
    }
    return { abort: () => request.onabort() };
  });
  return { files, requests, override };
}

export function exportedNote(
  topicId: number,
  body: string,
  origin = 'https://forum.example',
  title = 'Same Title',
  exported = '2026-01-01',
): string {
  return `---\ntitle: ${JSON.stringify(title)}\nsource: ${JSON.stringify(`${origin}/t/topic/${topicId}`)}\ntopic_id: ${topicId}\nxporter_version: 2\nexported: ${JSON.stringify(exported)}\n---\n\n${body}`;
}
