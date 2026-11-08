import assert from 'node:assert/strict';
import { test } from 'vitest';

import { DEL_CLOSE, DEL_OPEN, INS_CLOSE, INS_OPEN } from '@/modules/review/diff/documentDiff';
import { rehypeReviewMarks } from '@/modules/review/diff/rehypeReviewMarks';

const text = (value: string) => ({ type: 'text', value });
const element = (tagName: string, children: unknown[]) => ({ type: 'element', tagName, properties: {}, children });
const run = (children: unknown[]) => {
  const tree = { type: 'root', children };
  rehypeReviewMarks()(tree as never);
  return tree.children as any[];
};

test('wraps inserted and deleted text', () => {
  const [p] = run([element('p', [text(`a ${DEL_OPEN}b${DEL_CLOSE}${INS_OPEN}c${INS_CLOSE} d`)])]);
  assert.deepEqual(p.children.map((c: any) => c.tagName ?? c.value), ['a ', 'del', 'ins', ' d']);
});

test('a mark spanning inline formatting wraps each text fragment', () => {
  const [p] = run([element('p', [text(`${INS_OPEN}one `), element('strong', [text(`two${INS_CLOSE} three`)])])]);
  assert.equal(p.children[0].tagName, 'ins');
  assert.equal(p.children[1].children[0].tagName, 'ins');
  assert.equal(p.children[1].children[1].value, ' three');
});

test('inline code keeps a single string child and is wrapped whole', () => {
  const [p] = run([element('p', [element('code', [text(`x${INS_OPEN}y${INS_CLOSE}`)])])]);
  assert.equal(p.children[0].tagName, 'ins');
  assert.deepEqual(p.children[0].children[0].children, [{ type: 'text', value: 'xy' }]);
});
