import { describe, expect, it } from 'vitest';
import {
  actualFloorNumbers,
  refreshTopicNoteLinks,
  rewriteTopicLinks,
  type ExportedTopicNote,
} from '../src/export/topic-links';

function note(overrides: Partial<ExportedTopicNote> = {}): ExportedTopicNote {
  return {
    source: 'https://a.example/t/topic/10',
    topicId: 10,
    path: 'Discourse/a/Question-10.md',
    markdown:
      '---\nsource: "https://a.example/t/topic/10"\n---\n\n## Question ^floor-1\n',
    ...overrides,
  };
}

const answer = note({
  source: 'https://a.example/t/answer/20',
  topicId: 20,
  path: 'Discourse/a/Answer-20.md',
  markdown:
    '---\nsource: "https://a.example/t/answer/20"\n---\n\n## Answer ^floor-5\n',
});

describe('actualFloorNumbers', () => {
  it('uses unique real blocks outside frontmatter, code and comments', () => {
    const markdown = [
      '---',
      'example: ^floor-99',
      '---',
      '',
      '## valid ^floor-1',
      'inline `^floor-2`',
      '~~~~',
      'fake ^floor-3',
      '~~~~',
      '',
      '    fake ^floor-4',
      '',
      '<!--',
      'hidden ^floor-5',
      '-->',
      '> quoted ^floor-6',
      'first ^floor-7',
      'duplicate ^floor-7',
      '^floor-8',
    ].join('\n');
    expect([...actualFloorNumbers(markdown)]).toEqual([1, 8]);
  });
});

describe('rewriteTopicLinks', () => {
  it('resolves quotes, normal links and bare links against the actual destination path', () => {
    const current = note({
      markdown:
        note().markdown +
        [
          '> [!quote] [Answer](https://a.example/t/old-slug/20/5)',
          '[Whole topic](https://a.example/t/20)',
          '<https://a.example/t/answer/20#post_5>',
          'See (https://a.example/t/answer/20/5).',
          '/t/answer/20/5',
        ].join('\n'),
    });
    const renamed = { ...answer, path: 'Moved/New answer.md' };
    const rewritten = rewriteTopicLinks(current, [renamed]);
    expect(rewritten.markdown).toContain(
      '> [!quote] [[Moved/New answer#^floor-5|Answer]]',
    );
    expect(rewritten.markdown).toContain('[[Moved/New answer|Whole topic]]');
    expect(rewritten.markdown).toContain(
      '[[Moved/New answer#^floor-5|https://a.example/t/answer/20#post_5]]',
    );
    expect(rewritten.markdown).toContain(
      'See ([[Moved/New answer#^floor-5|https://a.example/t/answer/20/5]]).',
    );
    expect(rewritten.markdown).toContain(
      '[[Moved/New answer#^floor-5|/t/answer/20/5]]',
    );
    expect(rewritten.ambiguousTargets).toEqual([]);
    expect(
      rewriteTopicLinks({ ...current, markdown: rewritten.markdown }, [renamed])
        .markdown,
    ).toBe(rewritten.markdown);
  });

  it('keeps text labels while escaping wikilink delimiters', () => {
    const current = note({
      markdown:
        note().markdown + '[A \\[tag\\] | B](https://a.example/t/answer/20/5)',
    });
    expect(rewriteTopicLinks(current, [answer]).markdown).toContain(
      '[[Discourse/a/Answer-20#^floor-5|A \\[tag\\] &#124; B]]',
    );
  });

  it('uses local blocks only when they really exist, repairing stale local links', () => {
    const current = note({
      markdown:
        note().markdown +
        [
          '[Self](https://a.example/t/topic/10/1)',
          '[[#^floor-9|Missing reply]]',
          '[Missing answer](https://a.example/t/answer/20/6)',
        ].join('\n'),
    });
    const rewritten = rewriteTopicLinks(current, [answer]).markdown;
    expect(rewritten).toContain('[[#^floor-1|Self]]');
    expect(rewritten).toContain(
      '[Missing reply](https://a.example/t/topic/10/9)',
    );
    expect(rewritten).toContain(
      '[Missing answer](https://a.example/t/answer/20/6)',
    );
    expect(rewritten).not.toContain('[[#^floor-9');
  });

  it('keeps an ambiguous target on the source website instead of guessing a strategy', () => {
    const current = note({
      markdown: note().markdown + '[Answer](https://a.example/t/answer/20/5)',
    });
    const alternate = { ...answer, path: 'Other policy.md' };
    const rewritten = rewriteTopicLinks(current, [answer, alternate]);
    expect(rewritten.markdown).toBe(current.markdown);
    expect(rewritten.ambiguousTargets).toEqual([
      'https://a.example/t/topic/20',
    ]);
  });

  it('isolates identical topic IDs on different sites and validates note source identity', () => {
    const current = note({
      markdown:
        note().markdown +
        [
          '[Site B](https://b.example/t/answer/20/5)',
          '[Invalid metadata](https://a.example/t/answer/30/5)',
        ].join('\n'),
    });
    const mismatched = { ...answer, topicId: 30 };
    expect(rewriteTopicLinks(current, [answer, mismatched]).markdown).toBe(
      current.markdown,
    );
  });

  it('leaves frontmatter, images, definitions, HTML, comments and literal code unchanged', () => {
    const url = 'https://a.example/t/answer/20/5';
    const literal = [
      '---',
      `source: "${url}"`,
      '---',
      '',
      `![image](${url})`,
      `![reference][image]`,
      `[image]: ${url}`,
      '',
      `\`[code](${url})\``,
      '~~~~',
      `[code](${url})`,
      '~~~~',
      '',
      `    ${url}`,
      '',
      `<!-- ${url} -->`,
      `<a href="${url}" title="[literal](${url})">HTML</a>`,
    ].join('\n');
    const current = note({ markdown: literal });
    expect(rewriteTopicLinks(current, [answer]).markdown).toBe(literal);
  });

  it('resolves reference link usage without changing its shared image definition', () => {
    const current = note({
      markdown:
        note().markdown +
        [
          '[Answer][target]',
          '![Image][target]',
          '[target]: https://a.example/t/answer/20/5',
        ].join('\n'),
    });
    const rewritten = rewriteTopicLinks(current, [answer]).markdown;
    expect(rewritten).toContain('[[Discourse/a/Answer-20#^floor-5|Answer]]');
    expect(rewritten).toContain('![Image][target]');
    expect(rewritten).toContain('[target]: https://a.example/t/answer/20/5');
  });

  it('keeps unknown fragments and filter URLs as working website links', () => {
    const current = note({
      markdown:
        note().markdown +
        [
          '[Heading](https://a.example/t/answer/20#unknown)',
          '[Filtered](https://a.example/t/answer/20/5?filter=summary)',
        ].join('\n'),
    });
    expect(rewriteTopicLinks(current, [answer]).markdown).toBe(
      current.markdown,
    );
  });

  it('uses encoded Markdown paths for filenames containing wikilink delimiters', () => {
    const current = note({
      markdown: note().markdown + '[Answer](https://a.example/t/answer/20/5)',
    });
    const rewritten = rewriteTopicLinks(current, [
      { ...answer, path: 'Question#part[1].md' },
    ]).markdown;
    expect(rewritten).toContain(
      '[Answer](<../../Question%23part%5B1%5D.md#^floor-5>)',
    );
    expect(
      rewriteTopicLinks({ ...current, markdown: rewritten }, [answer]).markdown,
    ).toBe(rewritten);
  });
});

describe('refreshTopicNoteLinks', () => {
  it('returns writes only for selected changed exports and is idempotent', () => {
    const current = note({
      markdown: note().markdown + '[Answer](https://a.example/t/answer/20/5)',
    });
    const unrelated = note({
      path: 'Unselected.md',
      markdown: current.markdown,
    });
    const refreshed = refreshTopicNoteLinks([current], [answer, unrelated]);
    expect(refreshed.updates.map((update) => update.path)).toEqual([
      current.path,
    ]);
    expect(
      refreshTopicNoteLinks(
        [{ ...current, markdown: refreshed.updates[0].markdown }],
        [answer],
      ).updates,
    ).toEqual([]);
  });
});
