import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../src/config/defaults';
import {
  buildExportProfile,
  parseExportProfile,
  restoreExportProfile,
} from '../src/core/export-profile';
import type { FilterConfig } from '../src/types';

const filters: FilterConfig = {
  rangeMode: 'range',
  rangeStart: 3,
  rangeEnd: Infinity,
  onlyOp: false,
  imgFilter: 'withImg',
  users: ['Alice'],
  includeKeywords: ['guide'],
  excludeKeywords: [],
  minLength: 2,
};

describe('per-note export profiles', () => {
  it('round-trips an unbounded range and stable selected identities without saving connection settings', () => {
    const profile = buildExportProfile(
      {
        ...DEFAULTS,
        obsApiKey: 'SYNTHETIC_SECRET',
        obsApiUrl: 'http://localhost:1',
      },
      filters,
      new Map([[7, 913]]),
      new Set([7]),
    );
    expect(profile.filters.rangeEnd).toBeNull();
    const saved = JSON.stringify(profile);
    expect(saved).not.toContain('SYNTHETIC_SECRET');
    expect(saved).not.toContain('obsApi');
    expect(saved).not.toContain('batchDelay');
    const parsed = parseExportProfile(JSON.parse(saved));
    expect(parsed).toEqual(profile);
    const restored = restoreExportProfile(parsed!);
    expect(restored.filters).toEqual(filters);
    expect(restored.selectedPosts).toEqual(new Set([7]));
    expect(restored.selectedPostIds).toEqual(new Map([[7, 913]]));
  });

  it('copies filters and selections instead of retaining mutable UI state', () => {
    const original = { ...filters, users: ['Alice'] };
    const profile = buildExportProfile(DEFAULTS, original);
    original.users.push('Bob');
    const restored = restoreExportProfile(profile);
    restored.filters.users.push('Carol');
    expect(profile.filters.users).toEqual(['Alice']);
  });

  it('does not guess missing stable IDs or turn an empty manual selection into all posts', () => {
    expect(() =>
      buildExportProfile(DEFAULTS, { ...filters, rangeMode: 'selected' }),
    ).toThrow('No selected posts');
    expect(() =>
      buildExportProfile(DEFAULTS, filters, new Map(), new Set([7])),
    ).toThrow('Missing stable ID');
  });

  it('rejects unknown versions, invalid limits, conflicting post identities, and enum lookalikes', () => {
    const valid = buildExportProfile(
      DEFAULTS,
      filters,
      new Map([[7, 913]]),
      new Set([7]),
    );
    expect(parseExportProfile({ ...valid, version: 2 })).toBeUndefined();
    expect(
      parseExportProfile({
        ...valid,
        filters: { ...valid.filters, rangeEnd: 0 },
      }),
    ).toBeUndefined();
    expect(
      parseExportProfile({
        ...valid,
        selectedPosts: [...valid.selectedPosts, ...valid.selectedPosts],
      }),
    ).toBeUndefined();
    expect(
      parseExportProfile({
        ...valid,
        output: { ...valid.output, imgMode: { toString: () => 'file' } },
      }),
    ).toBeUndefined();
  });

  it('drops unknown persisted fields rather than copying them back into policy metadata', () => {
    const valid = buildExportProfile(DEFAULTS, filters);
    const parsed = parseExportProfile({
      ...valid,
      obsApiKey: 'SYNTHETIC_SECRET',
      output: { ...valid.output, obsApiKey: 'SYNTHETIC_SECRET' },
      filters: { ...valid.filters, debugMode: true },
    });
    expect(parsed).toEqual(valid);
    const extendedFilters = { ...filters, obsApiKey: 'SYNTHETIC_SECRET' };
    expect(buildExportProfile(DEFAULTS, extendedFilters)).toEqual(valid);
  });
});
