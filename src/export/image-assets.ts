import type { Config, ProgressCallback } from '../types';
import { fetchBinary } from '../core/api';
import { writeBinary, type ObsidianApiConfig } from './obsidian-api';
import { buildZip } from './zip-export';
import { downloadFile } from './download';
import { safeFilename } from '../utils/filename';
import { escapeObsidianAlias, unescapeMarkdownLabel } from '../utils/obsidian';
import { isAvatarUrl, isEmojiUrl } from '../utils/url';
import { sleepRandom } from '../utils/timing';
import { copyActiveBytesToArrayBuffer } from '../utils/binary';

export interface ImageAsset {
  url: string;
  filename: string;
}

export type ImageAssetMap = Map<string, ImageAsset>;

const IMAGE_LINK_RE = /!\[((?:\\.|[^\]\\])*)\]\((https?:\/\/[^\s)]+)\)/g;

export function resolveImgDir(config: Config): string {
  if (config.imgDirMode === 'absolute') return normalizeVaultPath(config.imgDir);
  if (!config.imgDir) return normalizeVaultPath(config.exportDir);
  return joinVaultPath(config.exportDir, config.imgDir);
}

export function joinVaultPath(...parts: string[]): string {
  return normalizeVaultPath(parts.join('/'));
}

export function normalizeVaultPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..')
    .filter((part) => !/^[a-zA-Z]:$/.test(part))
    .map(safePathSegment)
    .filter(Boolean)
    .join('/');
}

export function collectImageAssets(markdown: string): ImageAssetMap {
  const assets: ImageAssetMap = new Map();
  const usedNames = new Map<string, number>();
  let fallbackIndex = 0;
  let match: RegExpExecArray | null;

  IMAGE_LINK_RE.lastIndex = 0;
  while ((match = IMAGE_LINK_RE.exec(markdown)) !== null) {
    const url = match[2];
    if (isEmojiUrl(url) || isAvatarUrl(url) || assets.has(url)) continue;

    const baseName = filenameFromUrl(url, fallbackIndex++);
    const filename = dedupeFilename(baseName, usedNames);
    assets.set(url, { url, filename });
  }

  return assets;
}

export function rewriteImageUrlsForZip(
  markdown: string,
  assets: ImageAssetMap,
  imgDir: string,
  topicId: number,
): string {
  const basePath = joinVaultPath(imgDir, String(topicId));
  return markdown.replace(IMAGE_LINK_RE, (match, _alt: string, url: string) => {
    const asset = assets.get(url);
    if (!asset) return match;
    return match.replace(url, joinVaultPath(basePath, asset.filename));
  });
}

export function rewriteImageUrlsForObsidian(
  markdown: string,
  assets: ImageAssetMap,
  imgDir: string,
  topicId: number,
): string {
  const basePath = joinVaultPath(imgDir, String(topicId));
  return markdown.replace(
    IMAGE_LINK_RE,
    (match, alt: string, url: string) => {
      const asset = assets.get(url);
      if (!asset) return match;

      const path = joinVaultPath(basePath, asset.filename);
      const alias = escapeObsidianAlias(unescapeMarkdownLabel(alt));
      return alias ? `![[${path}|${alias}]]` : `![[${path}]]`;
    },
  );
}

export function stripImages(markdown: string): string {
  return markdown.replace(IMAGE_LINK_RE, (_match, alt: string) =>
    unescapeMarkdownLabel(alt),
  );
}

export async function downloadImageAssets(
  assets: ImageAssetMap,
  config: Config,
  onProgress?: ProgressCallback,
): Promise<Map<string, Uint8Array>> {
  const images = new Map<string, Uint8Array>();
  const entries = [...assets.values()];
  let completed = 0;
  const concurrency = Math.max(1, Math.floor(config.imageConcurrency));

  for (let i = 0; i < entries.length; i += concurrency) {
    if (i > 0) await sleepRandom(config.imageDelayMin, config.imageDelayMax);

    const chunk = entries.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (asset) => {
        try {
          images.set(asset.filename, await fetchBinary(asset.url));
        } catch {
          console.warn(`[DXP] Image download failed: ${asset.url}`);
        } finally {
          completed++;
          onProgress?.(
            `下载图片 ${completed}/${entries.length}`,
            completed / entries.length,
          );
        }
      }),
    );
  }

  return images;
}

export async function uploadImageAssets(
  assets: ImageAssetMap,
  apiCfg: ObsidianApiConfig,
  config: Config,
  imgDir: string,
  topicId: number,
  onProgress?: ProgressCallback,
): Promise<void> {
  const entries = [...assets.values()];
  const basePath = joinVaultPath(imgDir, String(topicId));

  for (let i = 0; i < entries.length; i++) {
    const asset = entries[i];
    onProgress?.(`上传图片 ${i + 1}/${entries.length}`, (i + 1) / entries.length);

    try {
      const binary = await fetchBinary(asset.url);
      await writeBinary(
        apiCfg,
        joinVaultPath(basePath, asset.filename),
        binary,
        guessMime(asset.filename),
      );
    } catch {
      console.warn(`[DXP] Image upload failed: ${asset.url}`);
    }
  }
}

export function buildImageZip(
  markdown: string,
  safeTitle: string,
  topicId: number,
  config: Config,
  images: Map<string, Uint8Array>,
): Uint8Array {
  return buildZip(
    `${safeTitle}.md`,
    markdown,
    resolveImgDir(config),
    topicId,
    images,
  );
}

export function downloadZipBytes(bytes: Uint8Array, safeTitle: string): void {
  downloadFile(
    new Blob([copyActiveBytesToArrayBuffer(bytes)], { type: 'application/zip' }),
    `${safeTitle}.zip`,
    'application/zip',
  );
}

export function guessMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
  };
  return mimes[ext ?? ''] ?? 'application/octet-stream';
}

function filenameFromUrl(url: string, fallbackIndex: number): string {
  try {
    const lastSegment = new URL(url).pathname.split('/').pop();
    return normalizeImageFilename(lastSegment, fallbackIndex);
  } catch {
    return normalizeImageFilename('', fallbackIndex);
  }
}

function normalizeImageFilename(filename: string | undefined, index: number): string {
  const decoded = safeDecodeURIComponent(filename ?? '');
  const safe = safePathSegment(safeFilename(decoded));
  return safe || `image_${index}`;
}

function dedupeFilename(filename: string, usedNames: Map<string, number>): string {
  const key = filename.toLowerCase();
  const count = usedNames.get(key) ?? 0;
  usedNames.set(key, count + 1);
  if (count === 0) return filename;

  const dot = filename.lastIndexOf('.');
  if (dot > 0) {
    return `${filename.slice(0, dot)}-${count + 1}${filename.slice(dot)}`;
  }
  return `${filename}-${count + 1}`;
}

function safePathSegment(segment: string): string {
  return segment
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
