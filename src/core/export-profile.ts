import type { Config, ExportProfile, FilterConfig } from '../types';

export function buildExportProfile(
  config: Config,
  filters?: FilterConfig,
  selectedPostIds: ReadonlyMap<number, number> = new Map(),
  selectedPosts: ReadonlySet<number> = new Set(),
): ExportProfile {
  const effectiveFilters: FilterConfig = filters ?? {
    rangeMode: 'all',
    rangeStart: 1,
    rangeEnd: Infinity,
    onlyOp: false,
    imgFilter: 'none',
    users: [],
    includeKeywords: [],
    excludeKeywords: [],
    minLength: 0,
  };
  const profile: ExportProfile = {
    version: 1,
    filters: {
      rangeMode: effectiveFilters.rangeMode,
      rangeStart: effectiveFilters.rangeStart,
      rangeEnd:
        effectiveFilters.rangeEnd === Infinity
          ? null
          : effectiveFilters.rangeEnd,
      onlyOp: effectiveFilters.onlyOp,
      imgFilter: effectiveFilters.imgFilter,
      users: [...effectiveFilters.users],
      includeKeywords: [...effectiveFilters.includeKeywords],
      excludeKeywords: [...effectiveFilters.excludeKeywords],
      minLength: effectiveFilters.minLength,
    },
    selectedPosts: [...selectedPosts]
      .sort((a, b) => a - b)
      .map((postNumber) => {
        const postId = selectedPostIds.get(postNumber);
        if (!isPositiveId(postId))
          throw new Error(`Missing stable ID for selected post #${postNumber}`);
        return { postNumber, postId };
      }),
    output: {
      exportDir: config.exportDir,
      imgMode: config.imgMode,
      imgDirMode: config.imgDirMode,
      imgDir: config.imgDir,
      floorTemplate: config.floorTemplate,
    },
  };
  if (
    effectiveFilters.rangeMode === 'selected' &&
    profile.selectedPosts.length === 0
  ) {
    throw new Error('No selected posts to save in export profile');
  }
  return profile;
}

/** Reject unknown versions and malformed policies; never guess a wider selection. */
export function parseExportProfile(value: unknown): ExportProfile | undefined {
  if (
    !isObject(value) ||
    value.version !== 1 ||
    !isObject(value.filters) ||
    !isObject(value.output)
  )
    return undefined;
  const filters = value.filters;
  const output = value.output;
  if (
    typeof filters.rangeMode !== 'string' ||
    !['all', 'range', 'selected'].includes(filters.rangeMode) ||
    !isPositiveId(filters.rangeStart) ||
    !(filters.rangeEnd === null || isPositiveId(filters.rangeEnd)) ||
    (typeof filters.rangeEnd === 'number' &&
      filters.rangeEnd < filters.rangeStart) ||
    typeof filters.onlyOp !== 'boolean' ||
    typeof filters.imgFilter !== 'string' ||
    !['none', 'withImg', 'noImg'].includes(filters.imgFilter) ||
    !isStringArray(filters.users) ||
    !isStringArray(filters.includeKeywords) ||
    !isStringArray(filters.excludeKeywords) ||
    typeof filters.minLength !== 'number' ||
    !Number.isSafeInteger(filters.minLength) ||
    filters.minLength < 0 ||
    typeof output.exportDir !== 'string' ||
    typeof output.imgDir !== 'string' ||
    typeof output.floorTemplate !== 'string' ||
    typeof output.imgMode !== 'string' ||
    !['file', 'embed', 'none'].includes(output.imgMode) ||
    typeof output.imgDirMode !== 'string' ||
    !['relative', 'absolute'].includes(output.imgDirMode) ||
    !Array.isArray(value.selectedPosts)
  )
    return undefined;
  const selectedPosts: ExportProfile['selectedPosts'] = [];
  const numbers = new Set<number>();
  const ids = new Set<number>();
  for (const entry of value.selectedPosts) {
    if (
      !isObject(entry) ||
      !isPositiveId(entry.postNumber) ||
      !isPositiveId(entry.postId) ||
      numbers.has(entry.postNumber) ||
      ids.has(entry.postId)
    )
      return undefined;
    numbers.add(entry.postNumber);
    ids.add(entry.postId);
    selectedPosts.push({ postNumber: entry.postNumber, postId: entry.postId });
  }
  if (filters.rangeMode === 'selected' && selectedPosts.length === 0)
    return undefined;
  // The boundary checks above establish the enums; rebuilding drops unknown fields, including secrets.
  return {
    version: 1,
    filters: {
      rangeMode: filters.rangeMode as FilterConfig['rangeMode'],
      rangeStart: filters.rangeStart,
      rangeEnd: filters.rangeEnd,
      onlyOp: filters.onlyOp,
      imgFilter: filters.imgFilter as FilterConfig['imgFilter'],
      users: [...filters.users],
      includeKeywords: [...filters.includeKeywords],
      excludeKeywords: [...filters.excludeKeywords],
      minLength: filters.minLength,
    },
    selectedPosts,
    output: {
      exportDir: output.exportDir,
      imgMode: output.imgMode as Config['imgMode'],
      imgDirMode: output.imgDirMode as Config['imgDirMode'],
      imgDir: output.imgDir,
      floorTemplate: output.floorTemplate,
    },
  };
}

export function restoreExportProfile(profile: ExportProfile): {
  config: ExportProfile['output'];
  filters: FilterConfig;
  selectedPosts: Set<number>;
  selectedPostIds: Map<number, number>;
} {
  return {
    config: { ...profile.output },
    filters: {
      ...profile.filters,
      rangeEnd: profile.filters.rangeEnd ?? Infinity,
      users: [...profile.filters.users],
      includeKeywords: [...profile.filters.includeKeywords],
      excludeKeywords: [...profile.filters.excludeKeywords],
    },
    selectedPosts: new Set(
      profile.selectedPosts.map((post) => post.postNumber),
    ),
    selectedPostIds: new Map(
      profile.selectedPosts.map((post) => [post.postNumber, post.postId]),
    ),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}
