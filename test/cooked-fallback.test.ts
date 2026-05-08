// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { cookedToMarkdown } from '../src/core/cooked-fallback';

describe('cookedToMarkdown', () => {
  it('escapes bracketed link text so Obsidian does not read it as a wikilink', () => {
    const result = cookedToMarkdown(
      '<p><a href="https://example.com/image.png">[image]</a></p>',
    );

    expect(result).toBe('[\\[image\\]](https://example.com/image.png)');
    expect(result).not.toContain('[[image]]');
  });

  it('converts Discourse footnote ids to Markdown footnotes', () => {
    const result = cookedToMarkdown(`
      <p>text <sup class="footnote-ref"><a href="#footnote-164979-1" id="footnote-ref-164979-1">[1]</a></sup></p>
      <hr class="footnotes-sep">
      <ol class="footnotes-list">
        <li id="footnote-164979-1" class="footnote-item"><p>note <a href="#footnote-ref-164979-1" class="footnote-backref">↩︎</a></p></li>
      </ol>
    `);

    expect(result).toContain('text [^164979-1]');
    expect(result).toContain('[^164979-1]: note');
    expect(result).not.toContain('[[1]]');
  });

  it('keeps lightbox images separated and escapes bracketed alt text', () => {
    const result = cookedToMarkdown(`
      <p>before</p>
      <div class="lightbox-wrapper">
        <a class="lightbox" href="https://example.com/image.png">
          <img src="https://example.com/thumb.png" alt="[image]">
        </a>
      </div>
      <p>after</p>
    `);

    expect(result).toContain(
      'before\n\n![\\[image\\]](https://example.com/image.png)\n\nafter',
    );
  });
});
