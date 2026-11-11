import type { BatchItem, Config, ProgressCallback } from '../types';
import type { TopicExportResult } from '../core/topic-export';
import { downloadFile } from './download';
import {
  buildImageZip,
  collectImageAssets,
  downloadImageAssets,
  downloadZipBytes,
  rewriteImageUrlsForObsidian,
  rewriteImageUrlsForZip,
  stripImages,
  uploadImageAssets,
} from './image-assets';
import {
  getNoteMetadata,
  noteMetadata,
  openNote,
  readVaultNote,
  searchByOrigin,
  searchByTopic,
  testConnection,
  writeNote,
  type ObsidianApiConfig,
} from './obsidian-api';
import { normalizeOrigin, sourceIdentity, topicPaths } from './paths';
import {
  refreshTopicNoteLinks,
  rewriteTopicLinks,
  type ExportedTopicNote,
} from './topic-links';

type ExportDocument = Pick<
  TopicExportResult,
  'markdown' | 'safeTitle' | 'topicId'
> & { origin: string };

export interface ZipTopicDelivery {
  downloadedFileKind: 'markdown' | 'zip';
}
export interface ObsidianDelivery {
  updated: boolean;
  openFailed?: string;
}

function asLinkedNote(
  document: ExportDocument,
  path: string,
): ExportedTopicNote {
  return {
    source: `${normalizeOrigin(document.origin)}/t/topic/${document.topicId}`,
    topicId: document.topicId,
    path,
    markdown: document.markdown,
  };
}

export function downloadTopicMarkdown(document: ExportDocument): void {
  const markdown = rewriteTopicLinks(
    asLinkedNote(document, `${document.safeTitle}.md`),
    [],
  ).markdown;
  downloadFile(
    markdown,
    `${document.safeTitle}.md`,
    'text/markdown;charset=utf-8',
  );
}

export async function downloadTopicZip(
  document: ExportDocument,
  config: Config,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<ZipTopicDelivery> {
  const snapshot = { ...document };
  const settings = { ...config };
  signal?.throwIfAborted();
  const imageAssets = collectImageAssets(snapshot.markdown, snapshot.origin);
  if (imageAssets.size === 0) {
    downloadTopicMarkdown(snapshot);
    return { downloadedFileKind: 'markdown' };
  }
  const imageDir = topicPaths(
    settings,
    snapshot.origin,
    snapshot.topicId,
    snapshot.safeTitle,
  ).imageDir;
  const images = await downloadImageAssets(
    imageAssets,
    settings,
    onProgress,
    signal,
  );
  signal?.throwIfAborted();
  const linked = rewriteTopicLinks(
    asLinkedNote(snapshot, `${snapshot.safeTitle}.md`),
    [],
  ).markdown;
  const markdown = rewriteImageUrlsForZip(linked, imageAssets, imageDir);
  onProgress?.('打包 ZIP…', 1);
  downloadZipBytes(
    buildImageZip(markdown, snapshot.safeTitle, imageDir, images),
    snapshot.safeTitle,
  );
  return { downloadedFileKind: 'zip' };
}

export async function writeTopicToConfiguredObsidian(
  document: ExportDocument,
  config: Config,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<ObsidianDelivery> {
  const snapshot = { ...document };
  const settings = { ...config };
  if (!settings.obsApiKey) throw new Error('请先配置 Obsidian API Key');
  const apiConfig = { apiUrl: settings.obsApiUrl, apiKey: settings.obsApiKey };
  onProgress?.('连接 Obsidian…', 0.1);
  if (!(await testConnection(apiConfig, signal)))
    throw new Error('无法连接 Obsidian Local REST API');
  const candidates = await searchByTopic(
    apiConfig,
    snapshot.origin,
    snapshot.topicId,
    signal,
  );
  const matches: string[] = [];
  for (const path of candidates) {
    const note = await getNoteMetadata(apiConfig, path, signal);
    if (
      note &&
      note.topicId === snapshot.topicId &&
      sourceIdentity(note.source, note.topicId).origin ===
        normalizeOrigin(snapshot.origin)
    )
      matches.push(path);
  }
  if (matches.length > 1)
    throw new Error(
      'Multiple exported notes match this topic; choose a specific note in batch re-export',
    );
  const notePath =
    matches[0] ??
    topicPaths(settings, snapshot.origin, snapshot.topicId, snapshot.safeTitle)
      .notePath;
  const delivery = await overwriteTopicObsidianNote(
    snapshot,
    settings,
    apiConfig,
    notePath,
    onProgress,
    signal,
  );
  if (settings.obsOpenAfterExport) {
    if (signal?.aborted)
      return { ...delivery, openFailed: '笔记已确认提交；已取消打开操作' };
    try {
      await openNote(apiConfig, notePath, signal);
    } catch (error) {
      return {
        ...delivery,
        openFailed: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return delivery;
}

async function exportedTargets(
  apiConfig: ObsidianApiConfig,
  origin: string,
  signal?: AbortSignal,
): Promise<ExportedTopicNote[]> {
  const targets: ExportedTopicNote[] = [];
  for (const path of await searchByOrigin(apiConfig, origin, signal)) {
    const note = await getNoteMetadata(apiConfig, path, signal);
    if (!note)
      throw new Error(`Exported note disappeared while reading: ${path}`);
    if (
      sourceIdentity(note.source, note.topicId).origin !==
      normalizeOrigin(origin)
    )
      throw new Error(`Exported note source does not match: ${path}`);
    targets.push({
      source: note.source,
      topicId: note.topicId,
      path,
      markdown: note.content,
    });
  }
  return targets;
}

export async function overwriteTopicObsidianNote(
  document: ExportDocument,
  config: Config,
  apiConfig: ObsidianApiConfig,
  notePath: string,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<{ updated: boolean }> {
  const snapshot = { ...document };
  const settings = { ...config };
  const connection = { ...apiConfig };
  const before = await readVaultNote(connection, notePath, signal);
  if (before) {
    const metadata = noteMetadata(notePath, before);
    if (
      !metadata ||
      metadata.topicId !== snapshot.topicId ||
      sourceIdentity(metadata.source, metadata.topicId).origin !==
        normalizeOrigin(snapshot.origin)
    )
      throw new Error(`Refusing to overwrite a different note: ${notePath}`);
  }
  let markdown = snapshot.markdown;
  if (settings.imgMode === 'none') markdown = stripImages(markdown);
  else if (settings.imgMode === 'file') {
    const assets = collectImageAssets(markdown, snapshot.origin);
    const imageDir = topicPaths(
      settings,
      snapshot.origin,
      snapshot.topicId,
      snapshot.safeTitle,
    ).imageDir;
    await uploadImageAssets(
      assets,
      connection,
      settings,
      imageDir,
      onProgress,
      signal,
    );
    markdown = rewriteImageUrlsForObsidian(markdown, assets, imageDir);
  }
  const targets = await exportedTargets(connection, snapshot.origin, signal);
  markdown = rewriteTopicLinks(
    { ...asLinkedNote(snapshot, notePath), markdown },
    targets,
  ).markdown;
  signal?.throwIfAborted();
  if (
    before &&
    withoutExportedTimestamp(before.content) ===
      withoutExportedTimestamp(markdown)
  )
    return { updated: false };
  // An external edit during downloads must not be silently replaced by an obsolete snapshot.
  const current = await readVaultNote(connection, notePath, signal);
  if (current?.content !== before?.content)
    throw new Error(`Target note changed during export: ${notePath}`);
  onProgress?.('写入笔记…', 0.9);
  await writeNote(connection, notePath, markdown, signal);
  return { updated: true };
}

export function withoutExportedTimestamp(markdown: string): string {
  const frontmatter = markdown.match(
    /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,
  )?.[0];
  if (!frontmatter) return markdown;
  return (
    frontmatter.replace(/^exported:.*(?:\r?\n|$)/m, '') +
    markdown.slice(frontmatter.length)
  );
}

/** Explicitly selected exported notes only; no other vault documents are written. */
export async function refreshObsidianNoteLinks(
  apiConfig: ObsidianApiConfig,
  origin: string,
  items: BatchItem[],
  signal?: AbortSignal,
): Promise<{ updated: number; ambiguous: number }> {
  const connection = { ...apiConfig };
  const normalized = normalizeOrigin(origin);
  const selected = items.map((item) => ({ ...item }));
  const targets = await exportedTargets(connection, normalized, signal);
  const notes: ExportedTopicNote[] = [];
  for (const item of selected) {
    const note = targets.find((target) => target.path === item.path);
    if (
      !note ||
      note.topicId !== item.topicId ||
      sourceIdentity(note.source, note.topicId).origin !== normalized
    )
      throw new Error(`Selected note identity changed: ${item.path}`);
    notes.push(note);
  }
  const planned = refreshTopicNoteLinks(notes, targets);
  let updated = 0;
  for (const change of planned.updates) {
    signal?.throwIfAborted();
    const before = notes.find((note) => note.path === change.path);
    const current = await readVaultNote(connection, change.path, signal);
    if (!before || current?.content !== before.markdown)
      throw new Error(
        `Target note changed during link refresh: ${change.path}`,
      );
    await writeNote(connection, change.path, change.markdown, signal);
    updated++;
  }
  return { updated, ambiguous: planned.ambiguousTargets.length };
}
