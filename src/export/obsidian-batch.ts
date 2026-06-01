import type { BatchItem, Config } from '../types';
import { buildTopicExport } from '../core/topic-export';
import { sleepRandom } from '../utils/timing';
import { joinVaultPath } from './image-assets';
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
}

export interface ObsidianBatchReExportSummary {
  success: number;
  failed: number;
}

export async function scanExportedNotesByOrigin(
  apiConfig: ObsidianApiConfig,
  origin: string,
): Promise<BatchItem[]> {
  const filenames = await searchByOrigin(apiConfig, origin);
  const items: BatchItem[] = [];

  for (const filename of filenames) {
    const metadata = await getNoteMetadata(apiConfig, filename);
    if (!metadata) continue;

    items.push({
      path: metadata.path,
      title: metadata.title,
      topicId: metadata.topicId,
      xporterVersion: metadata.xporterVersion,
    });
  }

  return items;
}

export async function reExportObsidianNotes(
  request: ObsidianBatchReExportRequest,
): Promise<ObsidianBatchReExportSummary> {
  let success = 0;
  let failed = 0;

  for (let index = 0; index < request.items.length; index++) {
    const item = request.items[index];
    request.onProgress(index + 1, request.items.length, item.title);

    if (index > 0) {
      await sleepRandom(
        request.config.batchDelayMin,
        request.config.batchDelayMax,
      );
    }

    try {
      await reExportObsidianNote(item, request);
      success++;
    } catch (error) {
      console.warn(
        `[DXP] Batch re-export failed for topic ${item.topicId}:`,
        error,
      );
      if (await retryRateLimitedReExport(item, request, error)) {
        success++;
      } else {
        failed++;
      }
    }
  }

  return { success, failed };
}

async function retryRateLimitedReExport(
  item: BatchItem,
  request: ObsidianBatchReExportRequest,
  error: unknown,
): Promise<boolean> {
  if (!(error instanceof Error) || !error.message.includes('429')) {
    return false;
  }

  await sleepRandom(
    request.config.batchDelayMax * 2,
    request.config.batchDelayMax * 2,
  );
  try {
    await reExportObsidianNote(item, request);
    return true;
  } catch {
    return false;
  }
}

async function reExportObsidianNote(
  item: BatchItem,
  request: ObsidianBatchReExportRequest,
): Promise<void> {
  const exportData = await buildTopicExport({
    topicId: item.topicId,
    origin: request.origin,
    forumName: request.forumName,
    formatVersion: request.formatVersion,
    config: request.config,
  });

  const notePath =
    item.path ||
    joinVaultPath(request.config.exportDir, `${exportData.safeTitle}.md`);
  await overwriteTopicObsidianNote(
    exportData,
    request.config,
    request.apiConfig,
    notePath,
  );
}
