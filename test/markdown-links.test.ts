import { describe, expect, it } from 'vitest';
import {
  findMarkdownImages,
  hasPostImages,
  markdownBodyOffset,
} from '../src/utils/markdown-links';

describe('Markdown image syntax', () => {
  it('uses complete destinations for titles, references, balanced parentheses and escapes', () => {
    const text = String.raw`![title](https://example.com/titled.png "title")
![ref][img]
![paren](https://example.com/file(2).png)
![angle](<https://example.com/a b.png> 'space')
![escaped](https://example.com/file\(3\).png)
![img][]
![img]
[img]: https://example.com/reference.png "reference title"`;
    expect(findMarkdownImages(text).map((image) => image.url)).toEqual([
      'https://example.com/titled.png',
      'https://example.com/reference.png',
      'https://example.com/file(2).png',
      'https://example.com/a b.png',
      'https://example.com/file(3).png',
      'https://example.com/reference.png',
      'https://example.com/reference.png',
    ]);
  });

  it('does not read image examples in arbitrary code runs, fences or indented blocks', () => {
    const text =
      '`` ![inline](https://x.example/1.png) ` ``\n\n~~~~\n![fence](https://x.example/2.png)\n~~~~\n\n    ![indent](https://x.example/3.png)\n\n![body](https://x.example/4.png)';
    expect(findMarkdownImages(text).map((image) => image.url)).toEqual([
      'https://x.example/4.png',
    ]);
  });

  it('filters cooked-only images and excludes code, emoji and avatars', () => {
    expect(
      hasPostImages(
        undefined,
        '<p><img src="https://cdn.example/image.png"></p>',
      ),
    ).toBe(true);
    expect(
      hasPostImages(
        undefined,
        '<pre><code>&lt;img src="https://cdn.example/image.png"&gt;</code></pre>',
      ),
    ).toBe(false);
    expect(hasPostImages('`![example](https://cdn.example/a.png)`', '')).toBe(
      false,
    );
    expect(
      hasPostImages(
        '![emoji](https://site.example/images/emoji/smile.png)',
        '',
      ),
    ).toBe(false);
  });
});

it('finds images nested in link labels and resolves escaped and multiline references', () => {
  const markdown = String.raw`[![inline](https://x.example/inline.png)](https://x.example/page)
[![reference][a\]b]](https://x.example/page)
![multiline][next]

[a\]b]: https://x.example/reference.png
[next]:
  <https://x.example/next.png> "title"`;
  expect(findMarkdownImages(markdown).map((image) => image.url)).toEqual([
    'https://x.example/inline.png',
    'https://x.example/reference.png',
    'https://x.example/next.png',
  ]);
});

it('honors list and quote containers for fenced and indented code', () => {
  const markdown =
    '- ~~~markdown\n  ![list-code](https://x.example/list-code.png)\n  ~~~\n\n' +
    '> - ~~~~markdown\n>   ![quote-list-code](https://x.example/quote-list-code.png)\n>   ~~~\n>   ~~~~\n\n' +
    '- > ~~~markdown\n  > ![list-quote-code](https://x.example/list-quote-code.png)\n  > ~~~\n\n' +
    '- item\n\n      ![indented-code](https://x.example/indented-code.png)\n\n' +
    '- item\n\n    ![list-real](https://x.example/list-real.png)\n\n' +
    '![real](https://x.example/real.png)';
  expect(findMarkdownImages(markdown).map((image) => image.url)).toEqual([
    'https://x.example/list-real.png',
    'https://x.example/real.png',
  ]);
});

it('ends a container code block when its parent container ends', () => {
  const markdown =
    '> ~~~markdown\n> ![code](https://x.example/code.png)\n\n![real](https://x.example/real.png)';
  expect(findMarkdownImages(markdown).map((image) => image.url)).toEqual([
    'https://x.example/real.png',
  ]);
});

it('excludes metadata and reference titles from attachment discovery', () => {
  const markdown =
    '---\ntitle: "![metadata](https://x.example/metadata.png)"\nexport_profile: {"floorTemplate":"` ![template](https://x.example/template.png)"}\n---\n' +
    '![real][image]\n\n[image]: https://x.example/real.png\n "![title](https://x.example/title.png)"';
  expect(findMarkdownImages(markdown).map((image) => image.url)).toEqual([
    'https://x.example/real.png',
  ]);
  const invalid =
    '![bad][x]\n\n[x]: https://x.example/invalid.png trailing garbage';
  expect(findMarkdownImages(invalid)).toEqual([]);
});

it('includes raw HTML images while keeping code and metadata literal', () => {
  expect(hasPostImages('<img src="https://x.example/image.png">', '')).toBe(
    true,
  );
  expect(hasPostImages('<img src=https://x.example/image.png>', '')).toBe(true);
  expect(hasPostImages('`<img src="https://x.example/image.png">`', '')).toBe(
    false,
  );
  expect(
    hasPostImages(
      '---\ntitle: \'<img src="https://x.example/image.png">\'\n---\nBody',
      '',
    ),
  ).toBe(false);
});

it('keeps lazy list paragraphs relative to their list indentation', () => {
  const markdown =
    '- item\ncontinued paragraph\n\n    ![real](https://x.example/real.png)';
  expect(findMarkdownImages(markdown).map((image) => image.url)).toEqual([
    'https://x.example/real.png',
  ]);
});

it('returns the body offset without treating horizontal-rule prose as metadata', () => {
  const body = '![real](https://x.example/real.png)';
  const header = '---\ntitle: "literal"\n...\n';
  expect(markdownBodyOffset(header + body)).toBe(header.length);
  expect(markdownBodyOffset('---\n' + body + '\n---')).toBe(0);
  expect(findMarkdownImages('---\n' + body + '\n---')).toHaveLength(1);
  expect(markdownBodyOffset('---\ntitle: "unclosed"')).toBe(0);
});

it('resolves quoted reference definitions without scanning their titles as images', () => {
  const markdown =
    '> ![alt][image]\n>\n> [image]:\n> https://x.example/image.png\n> "title ![literal](https://x.example/fake.png)"';
  expect(findMarkdownImages(markdown).map((image) => image.url)).toEqual([
    'https://x.example/image.png',
  ]);
});
