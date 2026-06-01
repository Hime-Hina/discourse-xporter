import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  openNote,
  searchByOrigin,
  searchOutdatedByTopicId,
  testConnection,
  writeBinary,
} from '../src/export/obsidian-api';

interface GmRequestDetails {
  method: string;
  url: string;
  headers?: Record<string, string>;
  data?: string | ArrayBuffer;
  onload: (response: { status: number; responseText: string }) => void;
  onerror: (error: unknown) => void;
}

function mockGm(status = 204, responseText = ''): GmRequestDetails[] {
  const requests: GmRequestDetails[] = [];
  vi.stubGlobal('GM_xmlhttpRequest', (details: GmRequestDetails) => {
    requests.push(details);
    details.onload({ status, responseText });
  });
  return requests;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('obsidian api', () => {
  it('writes only the active Uint8Array view bytes', async () => {
    const requests = mockGm();
    const source = new Uint8Array([1, 2, 3, 4]);

    await writeBinary(
      { apiUrl: 'https://127.0.0.1:27124', apiKey: 'key' },
      'attachments/image.bin',
      source.subarray(1, 3),
      'application/octet-stream',
    );

    expect(new Uint8Array(requests[0].data as ArrayBuffer)).toEqual(
      new Uint8Array([2, 3]),
    );
  });

  it('throws when opening a note fails', async () => {
    mockGm(500);

    await expect(
      openNote(
        { apiUrl: 'https://127.0.0.1:27124', apiKey: 'key' },
        'Discourse/topic.md',
      ),
    ).rejects.toThrow('HTTP 500');
  });

  it('does not send the bearer token to non-local API URLs', async () => {
    const spy = vi.fn();
    vi.stubGlobal('GM_xmlhttpRequest', spy);

    await expect(
      testConnection({ apiUrl: 'https://example.com:27124', apiKey: 'secret' }),
    ).resolves.toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('queries outdated notes with the current format version', async () => {
    const requests = mockGm(200, JSON.stringify([{ filename: 'topic.md' }]));

    await expect(
      searchOutdatedByTopicId(
        { apiUrl: 'https://127.0.0.1:27124', apiKey: 'key' },
        123,
        2,
      ),
    ).resolves.toBe(true);

    const query = String(requests[0].data);
    expect(query).toContain('"frontmatter.xporter_version"');
    expect(query).toContain(',2]');
  });

  it('surfaces user-triggered search failures', async () => {
    mockGm(500);

    await expect(
      searchByOrigin(
        { apiUrl: 'https://127.0.0.1:27124', apiKey: 'key' },
        'https://example.com',
      ),
    ).rejects.toThrow('HTTP 500');
  });
});
