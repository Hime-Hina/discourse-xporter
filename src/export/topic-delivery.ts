import type { Config, ProgressCallback } from '../types';
import type { TopicExportResult } from '../core/topic-export';
import { downloadFile } from './download';
import {
  buildImageZip,
  collectImageAssets,
  downloadImageAssets,
  downloadZipBytes,
  joinVaultPath,
  resolveImgDir,
  rewriteImageUrlsForObsidian,
  rewriteImageUrlsForZip,
  stripImages,
  uploadImageAssets,
} from './image-assets';
import {
  openNote,
  testConnection,
  writeNote,
  type ObsidianApiConfig,
} from './obsidian-api';

export interface ZipTopicDelivery {
  downloadedFileKind: 'markdown' | 'zip';
}

export function downloadTopicMarkdown(exportData: TopicExportResult): void {
  downloadFile(
    exportData.markdown,
    `${exportData.safeTitle}.md`,
    'text/markdown;charset=utf-8',
  );
}

export async function downloadTopicZip(
  exportData: TopicExportResult,
  config: Config,
  onProgress?: ProgressCallback,
): Promise<ZipTopicDelivery> {
  const imageAssets = collectImageAssets(exportData.markdown);

  if (imageAssets.size === 0) {
    downloadTopicMarkdown(exportData);
    return { downloadedFileKind: 'markdown' };
  }

  const effectiveImgDir = resolveImgDir(config);
  const markdown = rewriteImageUrlsForZip(
    exportData.markdown,
    imageAssets,
    effectiveImgDir,
    exportData.topicId,
  );
  const images = await downloadImageAssets(imageAssets, config, onProgress);

  onProgress?.('打包 ZIP…', 1);
  const zipBytes = buildImageZip(
    markdown,
    exportData.safeTitle,
    exportData.topicId,
    config,
    images,
  );
  downloadZipBytes(zipBytes, exportData.safeTitle);
  return { downloadedFileKind: 'zip' };
}

export async function writeTopicToConfiguredObsidian(
  exportData: TopicExportResult,
  config: Config,
  onProgress?: ProgressCallback,
): Promise<void> {
  if (!config.obsApiKey) {
    throw new Error('请先配置 Obsidian API Key');
  }

  const apiConfig = {
    apiUrl: config.obsApiUrl,
    apiKey: config.obsApiKey,
  };

  onProgress?.('连接 Obsidian…', 0.1);
  const connected = await testConnection(apiConfig);
  if (!connected) {
    throw new Error('无法连接 Obsidian Local REST API');
  }

  const notePath = joinVaultPath(
    config.exportDir,
    `${exportData.safeTitle}.md`,
  );
  await overwriteTopicObsidianNote(
    exportData,
    config,
    apiConfig,
    notePath,
    onProgress,
  );

  if (config.obsOpenAfterExport) {
    await openNote(apiConfig, notePath);
  }
}

export async function overwriteTopicObsidianNote(
  exportData: TopicExportResult,
  config: Config,
  apiConfig: ObsidianApiConfig,
  notePath: string,
  onProgress?: ProgressCallback,
): Promise<void> {
  const markdown = await materializeObsidianNoteMarkdown(
    exportData,
    config,
    apiConfig,
    onProgress,
  );

  onProgress?.('写入笔记…', 0.9);
  await writeNote(apiConfig, notePath, markdown);
}

async function materializeObsidianNoteMarkdown(
  exportData: TopicExportResult,
  config: Config,
  apiConfig: ObsidianApiConfig,
  onProgress?: ProgressCallback,
): Promise<string> {
  if (config.imgMode === 'none') {
    return stripImages(exportData.markdown);
  }

  if (config.imgMode !== 'file') {
    return exportData.markdown;
  }

  const imageAssets = collectImageAssets(exportData.markdown);
  const effectiveImgDir = resolveImgDir(config);
  await uploadImageAssets(
    imageAssets,
    apiConfig,
    config,
    effectiveImgDir,
    exportData.topicId,
    onProgress,
  );
  return rewriteImageUrlsForObsidian(
    exportData.markdown,
    imageAssets,
    effectiveImgDir,
    exportData.topicId,
  );
}
