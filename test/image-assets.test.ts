import { describe, expect, it } from 'vitest';
import {
  collectImageAssets,
  joinVaultPath,
  normalizeVaultPath,
  rewriteImageUrlsForObsidian,
  rewriteImageUrlsForZip,
} from '../src/export/image-assets';

describe('image assets', () => {
  it('deduplicates filenames for different URLs with the same basename', () => {
    const markdown = [
      '![one](https://cdn.example.com/a/image.png)',
      '![two](https://cdn.example.com/b/image.png)',
      '![again](https://cdn.example.com/a/image.png)',
    ].join('\n');

    const assets = collectImageAssets(markdown);

    expect(assets.get('https://cdn.example.com/a/image.png')?.filename).toBe(
      'image.png',
    );
    expect(assets.get('https://cdn.example.com/b/image.png')?.filename).toBe(
      'image-2.png',
    );
    expect(assets.size).toBe(2);
  });

  it('uses one asset map for ZIP and Obsidian rewrites', () => {
    const markdown = '![a|b](https://cdn.example.com/a/image.png)';
    const assets = collectImageAssets(markdown);

    expect(rewriteImageUrlsForZip(markdown, assets, 'attachments', 123)).toBe(
      '![a|b](attachments/123/image.png)',
    );
    expect(
      rewriteImageUrlsForObsidian(markdown, assets, 'attachments', 123),
    ).toBe('![[attachments/123/image.png|a&#124;b]]');
  });

  it('normalizes vault paths and removes dangerous segments', () => {
    expect(normalizeVaultPath('../Discourse//C:/../attachments')).toBe(
      'Discourse/attachments',
    );
    expect(joinVaultPath('Discourse', '..', 'attachments', 'a:b.png')).toBe(
      'Discourse/attachments/a_b.png',
    );
  });
});
