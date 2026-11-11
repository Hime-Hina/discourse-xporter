import type { Config } from '../types';

export function normalizeOrigin(source: string): string {
  const url = new URL(source);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error('Invalid forum origin');
  }
  return url.origin;
}

export function sourceIdentity(
  source: string,
  topicId: number,
): { origin: string; topicId: number } {
  if (!Number.isSafeInteger(topicId) || topicId < 1)
    throw new Error('Invalid topic ID');
  const url = new URL(source);
  const match = url.pathname.match(
    /^\/(?:t|nested)\/(?:[^/]+\/)?(\d+)(?:\/\d+)?\/?$/,
  );
  if (!match || Number(match[1]) !== topicId)
    throw new Error('Note source does not match topic ID');
  return { origin: normalizeOrigin(source), topicId };
}

/** Reversible origin encoding, including scheme and port; never uses a mutable site title. */
export function siteKey(origin: string): string {
  const normalized = normalizeOrigin(origin);
  const key = normalized
    .replace('://', '--')
    .replace(
      /[^a-z0-9.-]/g,
      (character) => `~${character.charCodeAt(0).toString(16)}`,
    )
    .replace(/\.+$/, (dots) => '~2e'.repeat(dots.length));
  if (key.length > 255)
    throw new Error('Forum origin is too long for a portable directory name');
  return key;
}

export function safePathSegment(segment: string): string {
  return segment
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim();
}

export function normalizeVaultPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(
      (part) =>
        part && part !== '.' && part !== '..' && !/^[a-zA-Z]:$/.test(part),
    )
    .map(safePathSegment)
    .filter(Boolean)
    .join('/');
}

export function joinVaultPath(...parts: string[]): string {
  return normalizeVaultPath(parts.join('/'));
}

export function resolveImgDir(
  config: Pick<Config, 'imgDirMode' | 'imgDir' | 'exportDir'>,
): string {
  return config.imgDirMode === 'absolute'
    ? normalizeVaultPath(config.imgDir)
    : joinVaultPath(config.exportDir, config.imgDir);
}

export function topicPaths(
  config: Pick<Config, 'imgDirMode' | 'imgDir' | 'exportDir'>,
  origin: string,
  topicId: number,
  safeTitle: string,
): { notePath: string; imageDir: string } {
  if (!Number.isSafeInteger(topicId) || topicId < 1)
    throw new Error('Invalid topic ID');
  const site = siteKey(origin);
  return {
    notePath: joinVaultPath(
      config.exportDir,
      site,
      `${safeTitle}--${topicId}.md`,
    ),
    imageDir: joinVaultPath(resolveImgDir(config), site, String(topicId)),
  };
}
