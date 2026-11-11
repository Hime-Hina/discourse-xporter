import type { Config, ProgressCallback } from '../types';
import { fetchBinary } from '../core/api';
import {
  readBinary,
  writeBinary,
  UncertainWriteError,
  type ObsidianApiConfig,
} from './obsidian-api';
import { buildZip } from './zip-export';
import { downloadFile } from './download';
import {
  markdownLabelToObsidianAlias,
  unescapeMarkdownLabel,
} from '../utils/obsidian';
import {
  findMarkdownImages,
  hasPostImages,
  markdownBodyOffset,
} from '../utils/markdown-links';
import { transformOutsideCode } from '../utils/markdown-code';
import { isAvatarUrl, isEmojiUrl } from '../utils/url';
import { sleepRandom } from '../utils/timing';
import { copyActiveBytesToArrayBuffer } from '../utils/binary';
import { joinVaultPath, safePathSegment } from './paths';

export interface ImageAsset {
  url: string;
  filename: string;
  bytes?: Uint8Array;
}

export type ImageAssetMap = Map<string, ImageAsset>;
type ImageOptions = Pick<
  Config,
  'imageConcurrency' | 'imageDelayMin' | 'imageDelayMax'
>;

export function collectImageAssets(
  markdown: string,
  origin?: string,
): ImageAssetMap {
  const assets: ImageAssetMap = new Map();
  // HTML images retained by raw Markdown need an explicit conversion; never claim a complete ZIP.
  let htmlImage = false;
  transformOutsideCode(markdown.slice(markdownBodyOffset(markdown)), (text) => {
    htmlImage = hasPostImages(undefined, text);
    return text;
  });
  if (htmlImage)
    throw new Error(
      'HTML image syntax is not supported in file mode; use embed mode or Markdown images',
    );
  for (const image of findMarkdownImages(markdown)) {
    if (assets.has(image.url)) continue;
    let url: URL;
    try {
      url = new URL(image.url, origin);
    } catch {
      throw new Error(`Unsupported image URL: ${image.url}`);
    }
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error(`Unsupported image URL: ${image.url}`);
    if (isEmojiUrl(url.href) || isAvatarUrl(url.href)) continue;
    // Names become content addresses only after the mandatory download has succeeded.
    assets.set(image.url, { url: url.href, filename: '' });
  }
  return assets;
}

function rewriteImages(
  markdown: string,
  replace: (image: ReturnType<typeof findMarkdownImages>[number]) => string,
): string {
  for (const image of findMarkdownImages(markdown).reverse()) {
    markdown =
      markdown.slice(0, image.start) +
      replace(image) +
      markdown.slice(image.end);
  }
  return markdown;
}

export function rewriteImageUrlsForZip(
  markdown: string,
  assets: ImageAssetMap,
  imageDir: string,
): string {
  return rewriteImages(markdown, (image) => {
    const asset = assets.get(image.url);
    if (!asset) return markdown.slice(image.start, image.end);
    if (!asset.filename)
      throw new Error('Image assets have not been materialized');
    const path = joinVaultPath(imageDir, asset.filename);
    return `![${image.alt}](<${path}>)`;
  });
}

export function rewriteImageUrlsForObsidian(
  markdown: string,
  assets: ImageAssetMap,
  imageDir: string,
): string {
  return rewriteImages(markdown, (image) => {
    const asset = assets.get(image.url);
    if (!asset) return markdown.slice(image.start, image.end);
    if (!asset.filename)
      throw new Error('Image assets have not been materialized');
    const path = joinVaultPath(imageDir, asset.filename);
    const alias = markdownLabelToObsidianAlias(image.alt);
    return alias ? `![[${path}|${alias}]]` : `![[${path}]]`;
  });
}

export function stripImages(markdown: string): string {
  return rewriteImages(markdown, (image) => unescapeMarkdownLabel(image.alt));
}

async function contentFilename(
  bytes: Uint8Array,
  url: string,
): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new Error('File mode requires Web Crypto; open the forum over HTTPS');
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', copyActiveBytesToArrayBuffer(bytes)),
  );
  const hash = [...digest]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const extension = safePathSegment(
    new URL(url).pathname.split('.').pop() ?? '',
  ).toLowerCase();
  return `${hash}${/^[a-z0-9]{1,8}$/.test(extension) ? `.${extension}` : '.bin'}`;
}

/** Settle every in-flight branch before reporting failure or releasing the operation lock. */
async function materializeChunks(
  assets: ImageAssetMap,
  config: ImageOptions,
  action: (asset: ImageAsset) => Promise<void>,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<void> {
  const entries = [...assets.values()];
  const concurrency = Math.max(1, Math.floor(config.imageConcurrency));
  let completed = 0;
  for (let index = 0; index < entries.length; index += concurrency) {
    signal?.throwIfAborted();
    if (index)
      await sleepRandom(config.imageDelayMin, config.imageDelayMax, signal);
    const settled = await Promise.allSettled(
      entries.slice(index, index + concurrency).map(async (asset) => {
        signal?.throwIfAborted();
        await action(asset);
        completed++;
        onProgress?.(
          `处理图片 ${completed}/${entries.length}`,
          completed / entries.length,
        );
      }),
    );
    const uncertain = settled.find(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === 'rejected' &&
        outcome.reason instanceof UncertainWriteError,
    );
    if (uncertain) throw uncertain.reason;
    const failed = settled.find(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === 'rejected',
    );
    if (failed) throw failed.reason;
  }
}

export async function downloadImageAssets(
  assets: ImageAssetMap,
  config: ImageOptions,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<Map<string, Uint8Array>> {
  const images = new Map<string, Uint8Array>();
  await materializeChunks(
    assets,
    config,
    async (asset) => {
      try {
        const bytes = await fetchBinary(asset.url, 60_000, signal);
        const filename = await contentFilename(bytes, asset.url);
        signal?.throwIfAborted();
        const existing = images.get(filename);
        if (existing && !sameBytes(existing, bytes))
          throw new Error('Content address collision');
        asset.filename = filename;
        asset.bytes = bytes;
        images.set(filename, bytes);
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new Error(
          `Image download failed for ${asset.url}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    onProgress,
    signal,
  );
  return images;
}

export async function uploadImageAssets(
  assets: ImageAssetMap,
  apiCfg: ObsidianApiConfig,
  config: ImageOptions,
  imageDir: string,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<void> {
  await downloadImageAssets(assets, config, onProgress, signal);
  // Equal content addresses are uploaded once even when multiple source URLs use the same bytes.
  const unique = new Map<string, ImageAsset>();
  for (const asset of assets.values()) unique.set(asset.filename, asset);
  await materializeChunks(
    unique,
    config,
    async (asset) => {
      const bytes = asset.bytes;
      if (!bytes) throw new Error('Missing materialized image');
      const path = joinVaultPath(imageDir, asset.filename);
      try {
        const existing = await readBinary(apiCfg, path, signal);
        if (existing) {
          if (!sameBytes(existing, bytes))
            throw new Error(
              `Refusing to overwrite different attachment bytes: ${path}`,
            );
          return;
        }
        signal?.throwIfAborted();
        await writeBinary(
          apiCfg,
          path,
          bytes,
          guessMime(asset.filename),
          signal,
        );
      } catch (error) {
        if (error instanceof UncertainWriteError) throw error;
        if (signal?.aborted) throw error;
        throw new Error(
          `Image upload failed for ${asset.url}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    onProgress,
    signal,
  );
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

export function buildImageZip(
  markdown: string,
  safeTitle: string,
  imageDir: string,
  images: Map<string, Uint8Array>,
): Uint8Array {
  return buildZip(`${safeTitle}.md`, markdown, imageDir, images);
}

export function downloadZipBytes(bytes: Uint8Array, safeTitle: string): void {
  downloadFile(
    new Blob([copyActiveBytesToArrayBuffer(bytes)], {
      type: 'application/zip',
    }),
    `${safeTitle}.zip`,
    'application/zip',
  );
}

export function guessMime(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase();
  const mimes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
  };
  return mimes[extension ?? ''] ?? 'application/octet-stream';
}
