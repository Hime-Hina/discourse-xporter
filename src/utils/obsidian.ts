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
