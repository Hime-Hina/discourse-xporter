// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { cookedToMarkdown } from '../src/core/cooked-fallback';
import { processRaw } from '../src/core/raw-pipeline';

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

describe('shared cooked enhancements', () => {
  it('chooses a fence longer than every run in the code contents', () => {
    expect(
      cookedToMarkdown(
        '<pre><code class="lang-markdown">\`\`\`js\nalert(1)\n\`\`\`</code></pre>',
      ),
    ).toBe('\`\`\`\`markdown\n\`\`\`js\nalert(1)\n\`\`\`\n\`\`\`\`');
  });

  it('shares full and inline Onebox rules between raw enhancement and fallback', () => {
    const context = {
      origin: 'https://example.com',
      topicId: 42,
      uploadMap: new Map(),
      polls: [],
    };
    const fixtures = [
      [
        'https://other.example/a',
        '<aside class="onebox" data-onebox-src="https://other.example/a"><article class="onebox-body"><h3>A [special] title</h3><p>Body</p></article></aside>',
      ],
      [
        '/t/source/7',
        '<aside class="onebox" data-onebox-src="/t/source/7"><header class="source"><a href="/t/source/7">Header</a></header><article class="onebox-body"><p><a href="/t/other/8">Body</a></p></article><div class="onebox-metadata">Metadata</div></aside>',
      ],
      [
        'https://other.example/b',
        '<aside class="onebox"><header class="source"><a href="https://other.example/b">Header</a></header><article class="onebox-body"><p>Body</p></article></aside>',
      ],
      [
        '/t/source/9',
        '<a class="inline-onebox" href="/t/source/9">A [special] title</a>',
      ],
    ];
    for (const [raw, html] of fixtures) {
      expect(processRaw(raw, { ...context, cookedHtml: html })).toBe(
        cookedToMarkdown(html, context),
      );
    }
  });

  it('uses a web link when cooked quotes have no rendered target', () => {
    const html =
      '<aside class="quote" data-username="alice" data-post="9" data-topic="42"><blockquote>Body</blockquote></aside>';
    expect(
      cookedToMarkdown(html, { origin: 'https://example.com', topicId: 42 }),
    ).toBe(
      '> [!quote] @alice · [#9](https://example.com/t/topic/42/9)\n> Body',
    );
    expect(
      cookedToMarkdown(html, {
        origin: 'https://example.com',
        topicId: 42,
        renderedPostNumbers: new Set([9]),
      }),
    ).toBe('> [!quote] @alice · [[#^floor-9|#9]]\n> Body');
  });
});
