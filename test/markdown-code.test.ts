import { describe, expect, it } from 'vitest';
import {
  markdownCodeRanges,
  transformOutsideCode,
} from '../src/utils/markdown-code';

describe('Markdown code regions', () => {
  it('preserves fence character, opening length, inline runs and indented code byte for byte', () => {
    const examples = [
      '````md\n```\n:smile:\n\n\n![x](x.png)\n```\n````\n',
      '~~~md\n```\n:smile:\n~~~\n',
      '> ~~~md\n> :smile:\n> ~~~\n',
      '``inline ` :smile:``',
      '    :smile:\n\n    ![x](x.png)\n',
      '\t:smile:\n',
      '```md\n:smile:',
    ];
    for (const code of examples) {
      expect(
        transformOutsideCode(code, (prose) =>
          prose.replaceAll(':smile:', 'changed').replace(/\n{3,}/g, '\n\n'),
        ),
      ).toBe(code);
    }
    expect(
      transformOutsideCode(':smile: `:smile:` :smile:', (prose) =>
        prose.replaceAll(':smile:', 'changed'),
      ),
    ).toBe('changed `:smile:` changed');
  });

  it('leaves unmatched inline delimiters and escaped ticks as ordinary prose', () => {
    expect(markdownCodeRanges('`one ``two')).toEqual([]);
    expect(markdownCodeRanges('\\`one\\`')).toEqual([]);
    expect(
      transformOutsideCode('\uE000DXPCODE0\uE001 `literal`', (s) => s),
    ).toBe('\uE000DXPCODE0\uE001 `literal`');
  });
});

it('preserves code bytes through nested quote and list containers', () => {
  for (const code of [
    '- ~~~md\n  :smile:\n  ~~~',
    '> - ~~~~md\n>   :smile:\n>   ~~~\n>   ~~~~',
    '- > ~~~md\n  > :smile:\n  > ~~~',
  ]) {
    expect(
      transformOutsideCode(code + '\n\n:smile:', (prose) =>
        prose.replaceAll(':smile:', 'changed'),
      ),
    ).toBe(code + '\n\nchanged');
  }
});
