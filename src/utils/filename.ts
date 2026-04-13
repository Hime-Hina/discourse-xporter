/** Make a string safe for use as a filename */
export function safeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract filename from URL, with optional index for dedup */
export function extractFilename(url: string, index?: number): string {
  try {
    const pathname = new URL(url).pathname;
    const lastSegment = pathname.split('/').pop() || `image_${index ?? 0}`;
    // Remove query-like suffixes that may linger
    return lastSegment.split('?')[0];
  } catch {
    return `image_${index ?? 0}`;
  }
}
