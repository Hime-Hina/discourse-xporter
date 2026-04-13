import { zipSync, type Zippable } from 'fflate';

/**
 * Build a ZIP archive containing the Markdown file and downloaded images.
 */
export function buildZip(
  mdFilename: string,
  mdContent: string,
  imgDir: string,
  topicId: number,
  images: Map<string, Uint8Array>,
): Uint8Array {
  const encoder = new TextEncoder();
  const zipData: Zippable = {};

  // Add markdown file
  zipData[mdFilename] = encoder.encode(mdContent);

  // Add images under {imgDir}/{topicId}/
  for (const [filename, binary] of images) {
    zipData[`${imgDir}/${topicId}/${filename}`] = binary;
  }

  return zipSync(zipData, { level: 0 });
}
