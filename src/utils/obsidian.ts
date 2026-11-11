export function escapeObsidianAlias(alias: string): string {
  return alias
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '&#124;')
    .replace(/([\[\]])/g, '\\$1');
}

export function unescapeMarkdownLabel(label: string): string {
  return label.replace(/\\([\\`*_[\]{}()#+\-.!|>])/g, '$1');
}

export function markdownLabelToObsidianAlias(label: string): string {
  return escapeObsidianAlias(unescapeMarkdownLabel(label));
}
import { markdownCodeRanges } from './markdown-code';
import { topicUrl } from './url';


/** Only opt into local links when the template explicitly emits a block ID. */
export function getRenderedPostNumbers(
  postNumbers: readonly number[],
  template: string,
): ReadonlySet<number> {
  const codeRanges = markdownCodeRanges(template);
  const comments = [...template.matchAll(/<!--[\s\S]*?(?:-->|$)/g)];
  const emitsBlockRef = [...template.matchAll(/{{block_ref}}/g)].some((match) => {
    const start = match.index;
    const end = start + match[0].length;
    return (
      (start === 0 || /[ \t\n]/.test(template[start - 1])) &&
      /^[ \t]*(?:\r?\n|$)/.test(template.slice(end)) &&
      !codeRanges.some((range) => start >= range.start && start < range.end) &&
      !comments.some((comment) => start >= comment.index && start < comment.index + comment[0].length)
    );
  });
  return new Set(emitsBlockRef ? postNumbers : []);
}

export function floorLink(
  origin: string,
  topicId: number,
  postNumber: number,
  renderedPostNumbers?: ReadonlySet<number>,
  label = `#${postNumber}`,
): string {
  if (renderedPostNumbers?.has(postNumber)) {
    return `[[#^floor-${postNumber}|${escapeObsidianAlias(label)}]]`;
  }
  const markdownLabel = label.replace(/([\\\[\]])/g, '\\$1');
  return `[${markdownLabel}](${topicUrl(origin, topicId, postNumber)})`;
}
