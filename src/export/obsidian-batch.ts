import type { BatchItem, Config, ExportProfile } from '../types';
import { buildTopicExport } from '../core/topic-export';
import {
  parseExportProfile,
  restoreExportProfile,
} from '../core/export-profile';
import { sleepRandom } from '../utils/timing';
import { normalizeOrigin, sourceIdentity } from './paths';
import {
  getNoteMetadata,
  searchByOrigin,
  type ObsidianApiConfig,
} from './obsidian-api';
import { overwriteTopicObsidianNote } from './topic-delivery';

export interface ObsidianBatchReExportRequest {
  items: BatchItem[];
  config: Config;
  apiConfig: ObsidianApiConfig;
  origin: string;
  forumName: string;
  formatVersion: number;
  onProgress: (current: number, total: number, title: string) => void;
  /** Present only after the user explicitly chooses to replace saved policies. */
  profileOverride?: ExportProfile;
  signal?: AbortSignal;
}

export interface ObsidianBatchReExportSummary {
  success: number;
  failed: number;
  updated: number;
  unchanged: number;
  cancelled: boolean;
  failures: { path: string; title: string; message: string }[];
  results: { path: string; status: 'updated' | 'unchanged' | 'failed' }[];
}

export async function scanExportedNotesByOrigin(
  apiConfig: ObsidianApiConfig,
  origin: string,
  signal?: AbortSignal,
): Promise<BatchItem[]> {
  const connection = { ...apiConfig };
  const sourceOrigin = normalizeOrigin(origin);
  signal?.throwIfAborted();
  const filenames = await searchByOrigin(connection, sourceOrigin, signal);
  const items: BatchItem[] = [];

  for (const filename of new Set(filenames)) {
    signal?.throwIfAborted();
    try {
      const metadata = await getNoteMetadata(connection, filename, signal);
      if (!metadata) continue;
      assertItemSource(metadata, sourceOrigin);
      items.push({
        path: metadata.path,
        title: metadata.title,
        topicId: metadata.topicId,
        xporterVersion: metadata.xporterVersion,
        source: metadata.source,
        exportProfile: parseExportProfile(metadata.exportProfile),
      });
    } catch (error) {
      signal?.throwIfAborted();
      throw new Error(
        `Cannot read exported note ${filename}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return items;
}

export async function reExportObsidianNotes(
  request: ObsidianBatchReExportRequest,
): Promise<ObsidianBatchReExportSummary> {
  const snapshot: ObsidianBatchReExportRequest = {
    ...request,
    config: { ...request.config },
    apiConfig: { ...request.apiConfig },
    origin: normalizeOrigin(request.origin),
    items: request.items.map((item) => ({
      ...item,
      exportProfile: parseExportProfile(item.exportProfile),
    })),
    profileOverride: parseExportProfile(request.profileOverride),
  };
  if (request.profileOverride && !snapshot.profileOverride)
    throw new Error('Invalid replacement export profile');
  const summary: ObsidianBatchReExportSummary = {
    success: 0,
    failed: 0,
    updated: 0,
    unchanged: 0,
    cancelled: false,
    failures: [],
    results: [],
  };

  for (let index = 0; index < snapshot.items.length; index++) {
    if (snapshot.signal?.aborted) {
      summary.cancelled = true;
      break;
    }
    const item = snapshot.items[index];
    snapshot.onProgress(index + 1, snapshot.items.length, item.title);

    try {
      if (index > 0) {
        await sleepRandom(
          snapshot.config.batchDelayMin,
          snapshot.config.batchDelayMax,
          snapshot.signal,
        );
      }
      snapshot.signal?.throwIfAborted();
      const delivery = await reExportObsidianNote(item, snapshot);
      summary.success++;
      if (delivery.updated) summary.updated++;
      else summary.unchanged++;
      summary.results.push({
        path: item.path,
        status: delivery.updated ? 'updated' : 'unchanged',
      });
    } catch (error) {
      if (
        snapshot.signal?.aborted &&
        (error === snapshot.signal.reason ||
          ((error instanceof Error || error instanceof DOMException) &&
            error.name === 'AbortError'))
      ) {
        summary.cancelled = true;
        break;
      }
      summary.failed++;
      summary.results.push({ path: item.path, status: 'failed' });
      summary.failures.push({
        path: item.path,
        title: item.title,
        message: error instanceof Error ? error.message : String(error),
      });
      if (snapshot.signal?.aborted) {
        summary.cancelled = true;
        break;
      }
    }
  }

  return summary;
}

async function reExportObsidianNote(
  item: BatchItem,
  request: ObsidianBatchReExportRequest,
): Promise<{ updated: boolean }> {
  assertItemSource(item, request.origin);
  if (!item.path) throw new Error('Missing exported note path');
  const profile = request.profileOverride ?? item.exportProfile;
  if (!profile)
    throw new Error(
      'Missing or unsupported export profile; choose replacement settings before re-exporting',
    );
  const restored = restoreExportProfile(profile);
  const config = { ...request.config, ...restored.config };
  const exportData = await buildTopicExport({
    topicId: item.topicId,
    origin: request.origin,
    forumName: request.forumName,
    formatVersion: request.formatVersion,
    config,
    filters: restored.filters,
    selectedPosts: restored.selectedPosts,
    selectedPostIds: restored.selectedPostIds,
    signal: request.signal,
  });

  return overwriteTopicObsidianNote(
    exportData,
    config,
    request.apiConfig,
    item.path,
    undefined,
    request.signal,
  );
}

function assertItemSource(
  item: Pick<BatchItem, 'source' | 'topicId'>,
  origin: string,
): void {
  if (sourceIdentity(item.source, item.topicId).origin !== origin) {
    throw new Error('Invalid or mismatched exported note source');
  }
}
