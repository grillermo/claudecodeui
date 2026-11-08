import assert from 'node:assert/strict';
import { test } from 'vitest';

import { hasReviewBlock, parseReviewSegments } from '@/modules/review/parsing/segments';
import { hashText, messageTarget } from '@/modules/review/parsing/hashText';

test('splits prose around a closed doc block and reads its attributes', () => {
  const text = 'Before\n\n:::doc id=upload-plan title="Image uploads" addresses=m1,m2\n# Plan\n\nBody\n:::\n\nAfter';
  const segments = parseReviewSegments(text);
  assert.deepEqual(segments.map((s) => s.type), ['markdown', 'doc', 'markdown']);
  const doc = segments[1];
  assert.ok(doc.type === 'doc');
  assert.equal(doc.id, 'upload-plan');
  assert.equal(doc.title, 'Image uploads');
  assert.deepEqual(doc.addresses, ['m1', 'm2']);
  assert.equal(doc.body, '# Plan\n\nBody');
  assert.equal(doc.open, false);
  assert.equal(doc.ordinal, 0);
});

test('a closer inside a code fence does not end the block', () => {
  const text = ':::doc id=a\n```md\n:::\n```\nend\n:::';
  const [doc] = parseReviewSegments(text);
  assert.ok(doc.type === 'doc');
  assert.equal(doc.body, '```md\n:::\n```\nend');
});

test('an opener inside a code fence is not a block', () => {
  assert.deepEqual(parseReviewSegments('```\n:::doc id=a\n:::\n```').map((s) => s.type), ['markdown']);
});

test('a nested directive keeps its closer inside the doc', () => {
  const [doc] = parseReviewSegments(':::doc id=a\n:::note\ninner\n:::\nouter\n:::');
  assert.ok(doc.type === 'doc');
  assert.equal(doc.body, ':::note\ninner\n:::\nouter');
});

test('unknown directives stay markdown', () => {
  assert.deepEqual(parseReviewSegments(':::warning\nx\n:::').map((s) => s.type), ['markdown']);
});

test('malformed: missing id, reserved id, unclosed', () => {
  assert.equal(parseReviewSegments(':::doc title="x"\nb\n:::')[0].type, 'malformed');
  assert.equal(parseReviewSegments(':::doc id=plan\nb\n:::')[0].type, 'malformed');
  const [unclosed] = parseReviewSegments('text\n\n:::doc id=a\nbody').slice(-1);
  assert.equal(unclosed.type, 'malformed');
  assert.equal(unclosed.type === 'malformed' && unclosed.raw, ':::doc id=a\nbody');
});

test('while streaming an unclosed doc is an open card', () => {
  const [doc] = parseReviewSegments(':::doc id=a\nbody so far', { streaming: true });
  assert.ok(doc.type === 'doc');
  assert.equal(doc.open, true);
  assert.equal(doc.body, 'body so far');
});

test('ordinals count docs within one message', () => {
  const docs = parseReviewSegments(':::doc id=a\n1\n:::\n\n:::doc id=b\n2\n:::').filter((s) => s.type === 'doc');
  assert.deepEqual(docs.map((d) => d.type === 'doc' && d.ordinal), [0, 1]);
});

test('hasReviewBlock is true only for known openers at line start', () => {
  assert.equal(hasReviewBlock('a\n:::doc id=x'), true);
  assert.equal(hasReviewBlock(':::feedback'), true);
  assert.equal(hasReviewBlock('see :::doc inline'), false);
  assert.equal(hasReviewBlock(':::warning'), false);
});

test('hashText is stable and 8 hex characters', () => {
  assert.match(hashText('hello'), /^[0-9a-f]{8}$/);
  assert.equal(hashText('hello'), hashText('hello'));
  assert.notEqual(hashText('hello'), hashText('hello!'));
  assert.equal(messageTarget('hello'), `msg:${hashText('hello')}`);
});
