import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNoteMetadata, openNote, readBinary, searchByOrigin, searchOutdatedByTopicId, testConnection, writeBinary, writeNote, UncertainWriteError } from '../src/export/obsidian-api';
import { exportedNote, installMemoryVault, type VaultRequest } from './vault-fixture';

const connection = { apiUrl: 'https://127.0.0.1:27124', apiKey: 'SYNTHETIC_KEY' };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Obsidian API trust and metadata boundary', () => {
  it('writes only active Uint8Array view bytes and forbids redirects', async () => {
    const vault = installMemoryVault();
    await writeBinary(connection, 'attachments/image.bin', new Uint8Array([1, 2, 3, 4]).subarray(1, 3), 'application/octet-stream');
    expect(vault.files.get('attachments/image.bin')).toEqual(new Uint8Array([2, 3]));
    expect(vault.requests[0].redirect).toBe('error');
  });

  it('does not send bearer credentials to non-local or malformed API bases', async () => {
    const gm = vi.fn();
    vi.stubGlobal('GM_xmlhttpRequest', gm);
    for (const apiUrl of ['https://example.com', 'https://localhost.example', 'https://user@localhost:27124', 'http://127.0.0.1:27124/elsewhere', 'http://localhost/?redirect=evil']) {
      expect(await testConnection({ ...connection, apiUrl })).toBe(false);
    }
    await expect(writeNote(connection, '../outside.md', 'content')).rejects.toThrow('Invalid vault path');
    expect(gm).not.toHaveBeenCalled();
  });

  it('limits outdated searches by origin and verifies returned metadata', async () => {
    const vault = installMemoryVault({ 'a.md': exportedNote(10, 'A', 'https://a.example'), 'b.md': exportedNote(10, 'B', 'https://b.example') });
    expect(await searchOutdatedByTopicId(connection, 10, 3, 'https://a.example')).toBe(true);
    const request = vault.requests.find(item => item.url.endsWith('/search/'));
    expect(String(request?.data)).toContain('https://a.example/*');
    expect(await searchOutdatedByTopicId(connection, 10, 2, 'https://a.example')).toBe(false);
  });

  it('distinguishes missing/non-export notes from malformed exported metadata', async () => {
    installMemoryVault({ 'ordinary.md': 'a note', 'invalid.md': '---\nsource: "https://forum.example/t/topic/10"\ntopic_id: -1\n---\nbody', 'mismatch.md': exportedNote(10, 'body').replace('/topic/10', '/topic/20') });
    expect(await getNoteMetadata(connection, 'missing.md')).toBeNull();
    expect(await getNoteMetadata(connection, 'ordinary.md')).toBeNull();
    await expect(getNoteMetadata(connection, 'invalid.md')).rejects.toThrow('Invalid export metadata');
    await expect(getNoteMetadata(connection, 'mismatch.md')).rejects.toThrow('does not match');
  });

  it('rejects metadata transport and JSON errors without pretending scan success', async () => {
    const vault = installMemoryVault();
    vault.override.handle = request => { request.onload({ status: 401, responseText: '' }); return true; };
    await expect(getNoteMetadata(connection, 'note.md')).rejects.toThrow('HTTP 401');
    expect(vault.requests).toHaveLength(1);
    vault.override.handle = request => { request.onload({ status: 200, responseText: '{' }); return true; };
    await expect(getNoteMetadata(connection, 'note.md')).rejects.toThrow();
    await expect(searchByOrigin(connection, 'https://forum.example')).rejects.toThrow();
  });

  it('keeps a confirmed note separate from an open-action failure', async () => {
    const vault = installMemoryVault();
    vault.override.handle = request => {
      if (!request.url.includes('/open/')) return false;
      request.onload({ status: 500, responseText: '' }); return true;
    };
    await expect(openNote(connection, 'note.md')).rejects.toThrow('HTTP 500');
  });
});

describe('bounded GM requests', () => {
  it('honors Retry-After only for safe reads and does not retry authentication failures', async () => {
    vi.useFakeTimers();
    const requests: VaultRequest[] = [];
    vi.stubGlobal('GM_xmlhttpRequest', (request: VaultRequest) => {
      requests.push(request);
      request.onload(requests.length === 1 ? { status: 429, responseText: '', responseHeaders: 'Retry-After: 3\r\n' } : { status: 404, responseText: '' });
      return { abort: vi.fn() };
    });
    const reading = getNoteMetadata(connection, 'note.md');
    await vi.advanceTimersByTimeAsync(2999);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await reading).toBeNull();
    expect(requests).toHaveLength(2);
  });

  it('terminates a hanging PUT once and reports an uncertain result', async () => {
    vi.useFakeTimers();
    const abort = vi.fn();
    vi.stubGlobal('GM_xmlhttpRequest', (request: VaultRequest) => { abort.mockImplementation(() => request.onabort()); return { abort }; });
    const writing = writeNote(connection, 'note.md', 'body');
    const rejected = expect(writing).rejects.toBeInstanceOf(UncertainWriteError);
    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;
    expect(abort).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels in-flight reads and never dispatches already-cancelled requests', async () => {
    const controller = new AbortController();
    const abort = vi.fn();
    const gm = vi.fn((request: VaultRequest) => { abort.mockImplementation(() => request.onabort()); return { abort }; });
    vi.stubGlobal('GM_xmlhttpRequest', gm);
    const reading = readBinary(connection, 'image.png', controller.signal);
    const rejected = expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(abort).toHaveBeenCalledTimes(1);
    await expect(writeNote(connection, 'note.md', 'body', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(gm).toHaveBeenCalledTimes(1);
  });
});
