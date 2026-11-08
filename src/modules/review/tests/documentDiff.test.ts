import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  DEL_CLOSE, DEL_OPEN, INS_CLOSE, INS_OPEN,
  diffDocument, splitMarkdownBlocks,
} from '@/modules/review/diff/documentDiff';

test('splits headings, paragraphs, list items, code fences and tables', () => {
  const blocks = splitMarkdownBlocks('# T\n\nPara\nline\n\n- a\n- b\n  more\n\n```js\nx\n\ny\n```\n\n| a |\n|---|\n| 1 |');
  assert.deepEqual(blocks.map((b) => b.kind), ['heading', 'text', 'list', 'list', 'code', 'table']);
  assert.equal(blocks[3].text, '- b\n  more');
  assert.equal(blocks[4].text, '```js\nx\n\ny\n```');
});

test('identical documents have no changes', () => {
  const result = diffDocument('# T\n\nBody', '# T\n\nBody');
  assert.equal(result.changeCount, 0);
  assert.deepEqual(result.runs, [{ type: 'markdown', markdown: '# T\n\nBody' }]);
});

test('an edited paragraph is word-diffed', () => {
  const result = diffDocument('Store files locally today', 'Store files remotely today');
  assert.equal(result.changeCount, 1);
  assert.deepEqual(result.runs, [{
    type: 'markdown',
    markdown: `Store files ${DEL_OPEN}locally${DEL_CLOSE}${INS_OPEN}remotely${INS_CLOSE} today`,
  }]);
});

test('added and deleted list items stay in one list, marked after the bullet', () => {
  const result = diffDocument('- keep\n- gone', '- keep\n- new one');
  assert.equal(result.changeCount, 2);
  assert.deepEqual(result.runs, [{
    type: 'markdown',
    markdown: `- keep\n- ${DEL_OPEN}gone${DEL_CLOSE}\n- ${INS_OPEN}new one${INS_CLOSE}`,
  }]);
});

test('a moved list item shows as one deletion and one insertion', () => {
  const result = diffDocument('- alpha one\n- beta two\n- gamma three', '- beta two\n- gamma three\n- alpha one');
  assert.equal(result.changeCount, 2);
  const markdown = result.runs[0].type === 'markdown' ? result.runs[0].markdown : '';
  assert.ok(markdown.includes(`${DEL_OPEN}alpha one${DEL_CLOSE}`));
  assert.ok(markdown.includes(`${INS_OPEN}alpha one${INS_CLOSE}`));
});

test('a changed code fence is a line diff run', () => {
  const result = diffDocument('```js\na\nb\n```', '```js\na\nc\n```');
  assert.equal(result.changeCount, 1);
  assert.deepEqual(result.runs, [{
    type: 'code',
    language: 'js',
    lines: [
      { status: 'same', text: 'a' },
      { status: 'removed', text: 'b' },
      { status: 'added', text: 'c' },
    ],
  }]);
});

test('a changed table is replaced as whole blocks so its syntax survives', () => {
  const result = diffDocument('| a |\n|---|\n| 1 |', '| a |\n|---|\n| 2 |');
  assert.deepEqual(result.runs.map((r) => r.type === 'block' && r.status), ['removed', 'added']);
});

test('very large documents fall back to whole-block changes', () => {
  const previous = Array.from({ length: 2001 }, (_, i) => `para number ${i} words`).join('\n\n');
  const next = previous.replace('para number 7 words', 'para number 7 wordz');
  const result = diffDocument(previous, next);
  assert.equal(result.changeCount, 2);
});

test('sentinel characters in the source cannot forge marks', () => {
  const result = diffDocument(`a${INS_OPEN}b`, `a${INS_OPEN}b`);
  assert.deepEqual(result.runs, [{ type: 'markdown', markdown: 'ab' }]);
});

test('a changed block marker is replaced whole so the markup survives', () => {
  const cases: Array<[string, string, string]> = [
    ['- foo', '* foo', `- ${DEL_OPEN}foo${DEL_CLOSE}\n* ${INS_OPEN}foo${INS_CLOSE}`],
    ['# Foo', '## Foo', `# ${DEL_OPEN}Foo${DEL_CLOSE}\n\n## ${INS_OPEN}Foo${INS_CLOSE}`],
    ['> foo', '>> foo', `> ${DEL_OPEN}foo${DEL_CLOSE}\n\n>> ${INS_OPEN}foo${INS_CLOSE}`],
    ['1. foo', '2. foo', `1. ${DEL_OPEN}foo${DEL_CLOSE}\n2. ${INS_OPEN}foo${INS_CLOSE}`],
  ];
  for (const [before, after, expected] of cases) {
    const result = diffDocument(before, after);
    assert.equal(result.changeCount, 2, before);
    assert.deepEqual(result.runs, [{ type: 'markdown', markdown: expected }], `${before} -> ${after}`);
  }
});

test('a large disjoint rewrite completes quickly', () => {
  const make = (tag: string) => Array.from({ length: 1500 }, (_, i) => `${tag}${i} ${tag}${i}x`).join('\n\n');
  const started = Date.now();
  const result = diffDocument(make('a'), make('b'));
  assert.ok(Date.now() - started < 1000);
  assert.equal(result.changeCount, 3000);
});

test('CRLF and LF versions of the same content have no changes', () => {
  const result = diffDocument('# T\r\n\r\nBody\r\nmore', '# T\n\nBody\nmore');
  assert.equal(result.changeCount, 0);
});
