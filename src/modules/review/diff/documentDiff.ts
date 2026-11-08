import { diffArrays, diffWordsWithSpace } from 'diff';

// Private-use characters marking changes inside markdown source. They survive
// the markdown parser as text, and rehypeReviewMarks turns them into elements.
export const INS_OPEN = '\ue000';
export const INS_CLOSE = '\ue001';
export const DEL_OPEN = '\ue002';
export const DEL_CLOSE = '\ue003';
const SENTINELS = /[\ue000-\ue003]/g;
const normalize = (text: string) => text.replace(/\r\n?/g, '\n').replace(SENTINELS, '');

const MAX_BLOCKS_FOR_WORD_DIFF = 2000;
const SIMILARITY_TO_PAIR = 0.4;
const MAX_PAIRINGS_PER_HUNK = 200_000;

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const HEADING = /^#{1,6}\s/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const TABLE_RULE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
/** The marker a change must not swallow, or the block stops being a list item or heading. */
const BLOCK_PREFIX = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+|(?:>\s?)+)/;

export type BlockKind = 'text' | 'list' | 'heading' | 'code' | 'table';
export type MarkdownBlock = { kind: BlockKind; text: string };
export type CodeLine = { status: 'same' | 'added' | 'removed'; text: string };
export type DiffRun =
  | { type: 'markdown'; markdown: string }
  | { type: 'block'; status: 'added' | 'removed'; markdown: string }
  | { type: 'code'; language: string; lines: CodeLine[] };
export type DocumentDiff = { runs: DiffRun[]; changeCount: number };

export function splitMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  const startsBlock = (line: string) => (
    !line.trim() || HEADING.test(line) || FENCE.test(line) || LIST_ITEM.test(line)
  );

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const start = index;
      index += 1;
      while (index < lines.length && !(lines[index].trim().startsWith(fence[1]) && FENCE.test(lines[index]))) {
        index += 1;
      }
      index = Math.min(index + 1, lines.length);
      blocks.push({ kind: 'code', text: lines.slice(start, index).join('\n') });
      continue;
    }

    if (HEADING.test(line)) {
      blocks.push({ kind: 'heading', text: line });
      index += 1;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const start = index;
      index += 1;
      while (index < lines.length && lines[index].trim() && !LIST_ITEM.test(lines[index])
        && /^\s/.test(lines[index])) {
        index += 1;
      }
      blocks.push({ kind: 'list', text: lines.slice(start, index).join('\n') });
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && TABLE_RULE.test(lines[index + 1])) {
      const start = index;
      while (index < lines.length && lines[index].includes('|')) {
        index += 1;
      }
      blocks.push({ kind: 'table', text: lines.slice(start, index).join('\n') });
      continue;
    }

    const start = index;
    index += 1;
    while (index < lines.length && !startsBlock(lines[index])) {
      index += 1;
    }
    blocks.push({ kind: 'text', text: lines.slice(start, index).join('\n') });
  }
  return blocks;
}

const wordSet = (text: string) => new Set(text.toLowerCase().split(/\W+/).filter(Boolean));

function similarity(wordsA: Set<string>, wordsB: Set<string>): number {
  if (wordsA.size === 0 || wordsB.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) {
      shared += 1;
    }
  }
  return (2 * shared) / (wordsA.size + wordsB.size);
}

const blockPrefix = (text: string) => BLOCK_PREFIX.exec(text)?.[0] ?? '';

function wrapWhole(text: string, open: string, close: string): string {
  const prefix = BLOCK_PREFIX.exec(text)?.[0] ?? '';
  return `${prefix}${open}${text.slice(prefix.length)}${close}`;
}

function wordDiff(previous: string, next: string): string {
  return diffWordsWithSpace(previous, next)
    .map((part) => {
      if (part.added) {
        return `${INS_OPEN}${part.value}${INS_CLOSE}`;
      }
      if (part.removed) {
        return `${DEL_OPEN}${part.value}${DEL_CLOSE}`;
      }
      return part.value;
    })
    .join('');
}

function parseFence(text: string): { language: string; body: string[] } {
  const lines = text.split('\n');
  const language = lines[0].replace(/^[\s`~]+/, '').trim();
  const hasCloser = lines.length > 1 && FENCE.test(lines[lines.length - 1]);
  return { language, body: lines.slice(1, hasCloser ? -1 : undefined) };
}

function codeDiff(previous: string, next: string): DiffRun {
  const before = parseFence(previous);
  const after = parseFence(next);
  const lines: CodeLine[] = [];
  for (const part of diffArrays(before.body, after.body)) {
    const status = part.added ? 'added' : part.removed ? 'removed' : 'same';
    for (const text of part.value) {
      lines.push({ status, text });
    }
  }
  return { type: 'code', language: after.language, lines };
}

/** Collects marked-up markdown blocks into runs a single parse can render. */
class RunBuilder {
  runs: DiffRun[] = [];
  private pending: MarkdownBlock[] = [];

  markdown(block: MarkdownBlock): void {
    this.pending.push(block);
  }

  run(run: DiffRun): void {
    this.flush();
    this.runs.push(run);
  }

  flush(): void {
    if (this.pending.length === 0) {
      return;
    }
    let markdown = this.pending[0].text;
    for (let index = 1; index < this.pending.length; index++) {
      const tight = this.pending[index].kind === 'list' && this.pending[index - 1].kind === 'list';
      markdown += `${tight ? '\n' : '\n\n'}${this.pending[index].text}`;
    }
    this.runs.push({ type: 'markdown', markdown });
    this.pending = [];
  }
}

const isOpaque = (kind: BlockKind) => kind === 'code' || kind === 'table';

function emitRemoved(builder: RunBuilder, block: MarkdownBlock): void {
  if (isOpaque(block.kind)) {
    builder.run({ type: 'block', status: 'removed', markdown: block.text });
  } else {
    builder.markdown({ kind: block.kind, text: wrapWhole(block.text, DEL_OPEN, DEL_CLOSE) });
  }
}

function emitAdded(builder: RunBuilder, block: MarkdownBlock): void {
  if (isOpaque(block.kind)) {
    builder.run({ type: 'block', status: 'added', markdown: block.text });
  } else {
    builder.markdown({ kind: block.kind, text: wrapWhole(block.text, INS_OPEN, INS_CLOSE) });
  }
}

/** Emits a hunk of replaced blocks, returning how many changes it counted. */
function emitHunk(
  builder: RunBuilder,
  removed: MarkdownBlock[],
  added: MarkdownBlock[],
  wholeBlocksOnly: boolean,
): number {
  let changes = 0;
  let nextAdded = 0;
  const skipPairing = wholeBlocksOnly || removed.length * added.length > MAX_PAIRINGS_PER_HUNK;
  const addedWords = skipPairing ? [] : added.map((b) => wordSet(b.text));
  for (const block of removed) {
    let match = -1;
    if (!skipPairing && block.kind !== 'table') {
      const removedWords = wordSet(block.text);
      const removedPrefix = blockPrefix(block.text);
      for (let index = nextAdded; index < added.length; index++) {
        const candidate = added[index];
        // A changed marker (`-` to `*`, `#` to `##`, `1.` to `2.`) is replaced whole so the markup survives.
        if (candidate.kind === block.kind
          && (block.kind === 'code' || (blockPrefix(candidate.text) === removedPrefix
            && similarity(removedWords, addedWords[index]) >= SIMILARITY_TO_PAIR))) {
          match = index;
          break;
        }
      }
    }
    if (match === -1) {
      emitRemoved(builder, block);
      changes += 1;
      continue;
    }
    for (; nextAdded < match; nextAdded++) {
      emitAdded(builder, added[nextAdded]);
      changes += 1;
    }
    if (block.kind === 'code') {
      builder.run(codeDiff(block.text, added[match].text));
    } else {
      builder.markdown({ kind: added[match].kind, text: wordDiff(block.text, added[match].text) });
    }
    changes += 1;
    nextAdded = match + 1;
  }
  for (; nextAdded < added.length; nextAdded++) {
    emitAdded(builder, added[nextAdded]);
    changes += 1;
  }
  return changes;
}

export function diffDocument(previous: string, next: string): DocumentDiff {
  const before = splitMarkdownBlocks(normalize(previous));
  const after = splitMarkdownBlocks(normalize(next));
  const wholeBlocksOnly = Math.max(before.length, after.length) > MAX_BLOCKS_FOR_WORD_DIFF;
  const parts = diffArrays(before.map((b) => b.text), after.map((b) => b.text));

  const builder = new RunBuilder();
  let changeCount = 0;
  let beforeIndex = 0;
  let afterIndex = 0;

  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    const count = part.value.length;
    if (!part.added && !part.removed) {
      after.slice(afterIndex, afterIndex + count).forEach((block) => builder.markdown(block));
      beforeIndex += count;
      afterIndex += count;
      continue;
    }
    let removedCount = part.removed ? count : 0;
    let addedCount = part.added ? count : 0;
    const following = parts[index + 1];
    if (following && (part.removed ? following.added : following.removed)) {
      removedCount = removedCount || following.value.length;
      addedCount = addedCount || following.value.length;
      index += 1;
    }
    changeCount += emitHunk(
      builder,
      before.slice(beforeIndex, beforeIndex + removedCount),
      after.slice(afterIndex, afterIndex + addedCount),
      wholeBlocksOnly,
    );
    beforeIndex += removedCount;
    afterIndex += addedCount;
  }

  builder.flush();
  return { runs: builder.runs, changeCount };
}
