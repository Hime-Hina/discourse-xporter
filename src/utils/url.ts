/** Resolve a relative Discourse path to a full URL */
export function resolveUrl(path: string, origin: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (path.startsWith('//')) return `https:${path}`;
  if (path.startsWith('/')) return `${origin}${path}`;
  return path;
}

/** Check if a URL points to a Discourse emoji image */
export function isEmojiUrl(url: string): boolean {
  return /\/images\/emoji\/|\/uploads\/.*emoji/i.test(url);
}

/** Check if a URL points to a user avatar */
export function isAvatarUrl(url: string): boolean {
  return /\/user_avatar\/|\/letter_avatar_proxy\//i.test(url);
}

/** Build a topic URL */
export function topicUrl(
  origin: string,
  topicId: number,
  postNumber?: number,
): string {
  const base = `${origin}/t/topic/${topicId}`;
  return postNumber ? `${base}/${postNumber}` : base;
}

/** Build an avatar URL from template */
export function avatarUrl(
  template: string,
  size: number,
  origin: string,
): string {
  const path = template.replace('{size}', String(size));
  return resolveUrl(path, origin);
}
