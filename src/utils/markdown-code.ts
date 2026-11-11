export interface MarkdownCodeRange {
  start: number;
  end: number;
}

type Container = { kind: 'quote' } | { kind: 'list'; width: number };

function continueContainers(
  line: string,
  parents: Container[],
  allowLazy: boolean,
): { content: string; parents: Container[] } {
  let content = line;
  const retained: Container[] = [];
  for (const parent of parents) {
    if (content.trim() === '') return { content, parents };
    if (parent.kind === 'quote') {
      const quote = content.match(/^ {0,3}> ?/);
      if (!quote) {
        if (allowLazy && !startsContainerBlock(content))
          return { content, parents };
        break;
      }
      content = content.slice(quote[0].length);
    } else {
      if (!content.startsWith(' '.repeat(parent.width))) {
        if (allowLazy && !startsContainerBlock(content))
          return { content, parents };
        break;
      }
      content = content.slice(parent.width);
    }
    retained.push(parent);
  }
  return { content, parents: retained };
}

function startsContainerBlock(line: string): boolean {
  return /^ {0,3}(?:`{3,}|~{3,}|>|[-+*](?: |$)|\d{1,9}[.)](?: |$)|#{1,6} |---(?: |$))/.test(
    line,
  );
}

function openContainers(
  line: string,
  parents: Container[],
): { content: string; parents: Container[] } {
  let content = line;
  const opened = [...parents];
  while (content) {
    const quote = content.match(/^ {0,3}> ?/);
    if (quote) {
      opened.push({ kind: 'quote' });
      content = content.slice(quote[0].length);
      continue;
    }
    const list = content.match(/^( {0,3})(?:[-+*]|\d{1,9}[.)])( +)/);
    if (!list) break;
    const padding = list[2].length > 4 ? 1 : list[2].length;
    const width = list[0].length - list[2].length + padding;
    opened.push({ kind: 'list', width });
    content = content.slice(width);
  }
  return { content, parents: opened };
}

/** Source offsets, including delimiters. Unclosed fences protect through EOF. */
export function markdownCodeRanges(text: string): MarkdownCodeRange[] {
  const blocks: MarkdownCodeRange[] = [];
  const lines = [...text.matchAll(/[^\n]*(?:\n|$)/g)].filter((line) => line[0]);
  let fence: { marker: string; length: number; start: number } | undefined;
  let indentStart: number | undefined;
  let indentEnd = 0;
  let previousBlank = true;
  let parents: Container[] = [];
  let fenceParentCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const start = line.index;
    const end = start + line[0].length;
    // Container indentation is relative: four spaces inside a two-space list
    // paragraph are ordinary content; six spaces introduce indented code.
    const sourceLine = line[0].replace(/\r?\n$/, '').replace(/\t/g, '    ');
    const continued = continueContainers(
      sourceLine,
      parents,
      !previousBlank && !fence && indentStart === undefined,
    );
    let content = continued.content;
    const lostParent = continued.parents.length < parents.length;
    parents = continued.parents;
    if (fence && lostParent && parents.length < fenceParentCount) {
      blocks.push({ start: fence.start, end: start });
      fence = undefined;
    }
    if (fence) {
      const close = content.match(/^ {0,3}(`+|~+)[ \t]*$/);
      if (
        close &&
        close[1][0] === fence.marker &&
        close[1].length >= fence.length
      ) {
        blocks.push({ start: fence.start, end });
        fence = undefined;
      }
      previousBlank = false;
      continue;
    }

    if (indentStart === undefined) {
      const opened = openContainers(content, parents);
      content = opened.content;
      parents = opened.parents;
    }

    const indented = /^(?: {4}|\t)/.test(content);
    const blank = /^\s*$/.test(content);
    if (indentStart !== undefined) {
      if (indented) {
        indentEnd = end;
        previousBlank = false;
        continue;
      }
      if (blank) {
        previousBlank = true;
        continue;
      }
      blocks.push({ start: indentStart, end: indentEnd });
      indentStart = undefined;
      const opened = openContainers(content, parents);
      content = opened.content;
      parents = opened.parents;
    }

    const open = content.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      fence = { marker: open[1][0], length: open[1].length, start };
      fenceParentCount = parents.length;
    } else if (indented && previousBlank) {
      indentStart = start;
      indentEnd = end;
    }
    previousBlank = blank;
  }
  if (fence) blocks.push({ start: fence.start, end: text.length });
  if (indentStart !== undefined)
    blocks.push({ start: indentStart, end: indentEnd });

  const ranges: MarkdownCodeRange[] = [];
  let cursor = 0;
  for (const block of [...blocks, { start: text.length, end: text.length }]) {
    const prose = text.slice(cursor, block.start);
    const runs = /`+/g;
    let opening: RegExpExecArray | null;
    while ((opening = runs.exec(prose))) {
      const before =
        prose.slice(0, opening.index).match(/\\+$/)?.[0].length ?? 0;
      if (before % 2) continue;
      let closing: RegExpExecArray | null;
      const search = new RegExp('`+', 'g');
      search.lastIndex = runs.lastIndex;
      while ((closing = search.exec(prose))) {
        if (closing[0].length === opening[0].length) {
          ranges.push({
            start: cursor + opening.index,
            end: cursor + search.lastIndex,
          });
          runs.lastIndex = search.lastIndex;
          break;
        }
      }
    }
    if (block.end > block.start) ranges.push(block);
    cursor = block.end;
  }
  return ranges;
}

/** Keep one transformation's block syntax intact while shielding literal code. */
export function protectMarkdownCode(text: string): {
  text: string;
  restore: (transformed: string) => string;
} {
  let prefix = '\uE000DXPCODE';
  while (text.includes(prefix)) prefix += 'X';
  const replacements = markdownCodeRanges(text).map(
    ({ start, end }, index) => ({
      start,
      end,
      token: `${prefix}${index}\uE001`,
      code: text.slice(start, end),
    }),
  );
  let protectedText = text;
  for (const entry of [...replacements].reverse()) {
    protectedText =
      protectedText.slice(0, entry.start) +
      entry.token +
      protectedText.slice(entry.end);
  }
  return {
    text: protectedText,
    restore: (transformed) => {
      for (const { token, code } of replacements)
        transformed = transformed.split(token).join(code);
      return transformed;
    },
  };
}

export function transformOutsideCode(
  text: string,
  transform: (prose: string) => string,
): string {
  const protectedCode = protectMarkdownCode(text);
  return protectedCode.restore(transform(protectedCode.text));
}
