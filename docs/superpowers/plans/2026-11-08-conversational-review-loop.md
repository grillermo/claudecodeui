# Conversational Review Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user select passages of Claude's output, attach comments, questions and redlines to them, send them as one feedback round, and see each revised document as a new message with its changes marked.

**Architecture:** A new `src/modules/review/` feature module holds pure logic (block parser, document diff, transcript index) and the UI built on it. Chat consumes it only through `src/modules/review/index.ts`. Claude's JSONL stays the only record of sent feedback; the only new persisted state is a `marks` column on `session_drafts` for unsent marks. Claude learns the formats through `systemPrompt.append`.

**Tech Stack:** React 18, TypeScript, react-markdown 10, `diff` (jsdiff) 9, CSS Custom Highlight API, better-sqlite3, Claude Agent SDK, vitest + jsdom (client), `node --test` via tsx (server).

**Spec:** `docs/superpowers/specs/2026-11-07-conversational-review-design.md`, sub-project 1 only. Question blocks, rich rendering and linked documents have their own plans.

---

## Where this plan departs from the spec

Each was found by checking the spec against the code on 2026-11-08.

1. **A line-based parser replaces `remark-directive`.** The spec's `:::doc id=x title="y"` is not valid directive syntax (attributes must be `{id=x}`), so remark-directive leaves the whole block as a paragraph. It also turns `10:30` and `foo:bar` into text directives in every message, which drops text unless repaired. The approved format stays; `parseReviewSegments` reads it. `useReviewIndex` needs the same parser on raw strings anyway, so there is one reader of the format instead of two.
2. **`msg:<short id>` is a hash of the message text, not a prefix of `transcriptAnchorId`.** `claude-sessions.provider.ts:1254` sets that id only on user rows, and `claude-sessions.test.ts:1768` pins that. A content hash needs no server change, exists as soon as a reply finishes, works for every provider, and survives reloads and forks.
3. **Mark ids are assigned at send time, not when a mark is created.** The first history page is 20 rows, so an id counted at creation could collide with one in an unloaded page. Sending also scans the queued message, so two quick queued rounds cannot reuse an id.

Two additions the spec does not list but needs:

- **Load the full history when review content is present** (Task 9). Otherwise a v3 in the 20-row window would be numbered v1.
- **Marks sent as a plan denial are read from the ExitPlanMode tool result** (Tasks 4 and 13). A denial is not a user message, and that tool's result is hidden today, so the round would otherwise be invisible and its mark ids reused.

## Known limits

- A quote card or badge linking to a passage in a row that `LazyMessageRow` has not mounted does nothing until the row is near the viewport.
- Identical document bodies in two messages share one index entry, so the earlier shows the later's version number. Session instructions tell Claude not to write a version when nothing changed.

## File structure

**Create, in `src/modules/review/`:**

| File | Responsibility |
|---|---|
| `index.ts` | The module's public surface |
| `types.ts` | Mark and segment types |
| `parsing/hashText.ts` | 8-character text hash and `messageTarget` |
| `parsing/segments.ts` | Split text into markdown / doc / feedback / malformed segments |
| `parsing/feedback.ts` | Read and write the `:::feedback` body |
| `diff/documentDiff.ts` | Block split, block match, word and line diff, render runs |
| `diff/rehypeReviewMarks.ts` | Turn diff sentinels into `<ins>` / `<del>` |
| `state/buildReviewIndex.ts` | Pure transcript index |
| `state/useReviewSession.ts` | Index, tray state, compose-on-send |
| `state/ReviewContext.tsx` | Context carrying the session to the transcript |
| `selection/resolveSelection.ts` | DOM selection to target and anchor |
| `selection/highlightRanges.ts` | Quote to DOM `Range`, Highlight registry |
| `components/ReviewSegments.tsx` | Render a segmented message |
| `components/DocVersion.tsx` | Version card with changes marked |
| `components/FeedbackRound.tsx` | Sent marks as quote cards |
| `components/PassageBadges.tsx` | "N discussions" chips under a target |
| `components/SelectionToolbar.tsx` | Comment / Ask / Redline on a selection |
| `components/MarksTray.tsx` | Unsent marks above the composer |
| `components/ReviewHighlights.tsx` | Paints highlights |

Tests live in `src/modules/review/tests/`.

**Create elsewhere:** `src/modules/chat/transcript/reviewMarkdown.tsx`, `server/modules/providers/list/claude/review-instructions.ts`, `server/modules/database/tests/session-drafts-marks.db.integration.test.ts`, `server/modules/providers/tests/claude-review-instructions.test.ts`, `scripts/review-unprompted-check.md`.

**Modify:** `Markdown.tsx`, `StreamingMarkdown.tsx`, `MessageComponent.tsx`, `ChatInterface.tsx`, `ChatComposer.tsx`, `useChatComposerState.ts`, `PlanDisplay.tsx`, `ToolRenderer.tsx`, `src/shared/chatDrafts.ts`, `src/shared/api.ts`, `src/index.css`, the `en` chat locale, `server/modules/database/{schema,migrations}.ts`, `session-drafts.db.ts`, `server/modules/user/{user.service,user.module}.ts`, `claude-runtime.provider.ts`.

## Conventions

- Run client tests with `npx vitest run <path>` and server tests with `npx tsx --tsconfig server/tsconfig.json --test <path>`.
- Vitest globals are off: import `test`, `vi` from `vitest`, and assert with `node:assert/strict`, as existing tests do.
- In tests, find elements by `data-testid` or role: `react-i18next` is not initialised under vitest.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 0: Branch and dependency

**Files:** Modify `package.json`, `package-lock.json`

- [ ] **Step 1: Create the implementation branch**

```bash
git switch -c feat/conversational-review
```

- [ ] **Step 2: Install jsdiff**

```bash
npm install diff@^9.0.0
```

It ships its own types, so no `@types/diff`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add jsdiff for review document diffs"
```

---

### Task 1: Types, hash and block segmenter

**Files:**
- Create: `src/modules/review/types.ts`, `src/modules/review/parsing/hashText.ts`, `src/modules/review/parsing/segments.ts`
- Test: `src/modules/review/tests/segments.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/modules/review/tests/segments.test.ts`
Expected: FAIL, cannot resolve `@/modules/review/parsing/segments`.

- [ ] **Step 3: Write the implementation**

`src/modules/review/types.ts`:

```ts
import type { StoredDraftMark } from '@/shared/chatDrafts';

export type MarkKind = 'comment' | 'question' | 'redline';

/** A passage: the quote, plus context only when the quote is ambiguous in its target. */
export type MarkAnchor = { quote: string; before?: string; after?: string };

/** A mark that has been sent, as read back from a `:::feedback` block. */
export type FeedbackMark = MarkAnchor & {
  id: string;
  kind: MarkKind;
  /** `<doc-id>@v<N>` or `msg:<hash>`. */
  target: string;
  note: string;
};

/** A mark still in the tray. Numbered only when it is sent. */
export type DraftMark = StoredDraftMark;

export type MarkdownSegment = { type: 'markdown'; text: string };
export type DocSegment = {
  type: 'doc';
  id: string;
  title?: string;
  addresses: string[];
  body: string;
  /** Still being written: no closing `:::` has arrived. */
  open: boolean;
  /** This doc's position among the docs of its message. */
  ordinal: number;
};
export type FeedbackSegment = { type: 'feedback'; marks: FeedbackMark[] };
export type MalformedSegment = { type: 'malformed'; raw: string };
export type ReviewSegment = MarkdownSegment | DocSegment | FeedbackSegment | MalformedSegment;
```

`src/modules/review/parsing/hashText.ts`:

```ts
/** FNV-1a, 32 bits. Short, dependency-free, and stable across reloads. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** The mark target for a selection in an assistant message outside any document. */
export function messageTarget(messageText: string): string {
  return `msg:${hashText(messageText)}`;
}
```

`src/modules/review/parsing/segments.ts`:

```ts
import { parseFeedbackBody } from '@/modules/review/parsing/feedback';
import type { ReviewSegment } from '@/modules/review/types';

const OPENER = /^:::(doc|feedback)(?:[ \t]+(.*?))?[ \t]*$/;
const ANY_DIRECTIVE_OPENER = /^:::[a-zA-Z]/;
const OPENER_ANYWHERE = /^:::(doc|feedback)\b/m;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const ATTRIBUTE = /([a-zA-Z]+)=(?:"([^"]*)"|([^\s"]+))/g;
const DOC_ID = /^[A-Za-z0-9][\w.-]*$/;
/** Reserved for ExitPlanMode plans, which are read from tool inputs. */
const RESERVED_DOC_ID = 'plan';

type Fence = { marker: string; length: number };

/** Cheap check so messages without blocks skip segmentation entirely. */
export function hasReviewBlock(text: string): boolean {
  return OPENER_ANYWHERE.test(text);
}

/** Applies one line to the fence state and returns the new state. */
function advanceFence(open: Fence | null, line: string): Fence | null {
  const match = FENCE.exec(line);
  if (!match) {
    return open;
  }
  const marker = match[1][0];
  const length = match[1].length;
  if (!open) {
    return { marker, length };
  }
  return marker === open.marker && length >= open.length && !match[2].trim() ? null : open;
}

/** The line index of the opener's matching `:::`, or -1 if it never closes. */
function findCloser(lines: string[], start: number): number {
  let fence: Fence | null = null;
  let depth = 1;
  for (let index = start; index < lines.length; index++) {
    const line = lines[index];
    const nextFence = advanceFence(fence, line);
    const lineIsFence = FENCE.test(line) && (nextFence !== fence || fence === null);
    fence = nextFence;
    if (fence || lineIsFence) {
      continue;
    }
    if (ANY_DIRECTIVE_OPENER.test(line)) {
      depth += 1;
    } else if (line.trimEnd() === ':::') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function readAttributes(raw: string | undefined): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of (raw ?? '').matchAll(ATTRIBUTE)) {
    attributes[match[1]] = match[2] ?? match[3];
  }
  return attributes;
}

/**
 * Splits a message into prose and review blocks. Never throws: anything it
 * cannot read comes back as a `malformed` segment holding the original text.
 */
export function parseReviewSegments(
  text: string,
  options: { streaming?: boolean } = {},
): ReviewSegment[] {
  const lines = text.split('\n');
  const segments: ReviewSegment[] = [];
  let prose: string[] = [];
  let fence: Fence | null = null;
  let ordinal = 0;

  const flushProse = () => {
    const joined = prose.join('\n');
    if (joined.trim()) {
      segments.push({ type: 'markdown', text: joined.replace(/^\n+|\n+$/g, '') });
    }
    prose = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const opener = fence ? null : OPENER.exec(line);
    if (!opener) {
      fence = advanceFence(fence, line);
      prose.push(line);
      continue;
    }

    flushProse();
    const [, kind, rawAttributes] = opener;
    const closer = findCloser(lines, index + 1);
    const end = closer === -1 ? lines.length : closer;
    const body = lines.slice(index + 1, end).join('\n');
    const raw = lines.slice(index, closer === -1 ? lines.length : closer + 1).join('\n');
    index = closer === -1 ? lines.length : closer;

    if (kind === 'doc') {
      const attributes = readAttributes(rawAttributes);
      const id = attributes.id ?? '';
      const canBeDoc = DOC_ID.test(id) && id !== RESERVED_DOC_ID;
      if (!canBeDoc || (closer === -1 && !options.streaming)) {
        segments.push({ type: 'malformed', raw });
        continue;
      }
      segments.push({
        type: 'doc',
        id,
        ...(attributes.title ? { title: attributes.title } : {}),
        addresses: (attributes.addresses ?? '').split(',').filter(Boolean),
        body,
        open: closer === -1,
        ordinal: ordinal++,
      });
      continue;
    }

    const marks = closer === -1 ? null : parseFeedbackBody(body);
    segments.push(marks ? { type: 'feedback', marks } : { type: 'malformed', raw });
  }

  flushProse();
  return segments;
}
```

`src/modules/review/parsing/feedback.ts` (stub so this task compiles; Task 2 replaces it):

```ts
import type { FeedbackMark } from '@/modules/review/types';

export function parseFeedbackBody(_body: string): FeedbackMark[] | null {
  return null;
}
```

Add the shared type this task imports to `src/shared/chatDrafts.ts`, directly above `type DraftRecord`:

```ts
/** A review mark waiting in the composer tray. The server stores these opaquely. */
export type StoredDraftMark = {
  /** Local identity; the sent id (`m1`) is assigned when the round is sent. */
  key: string;
  kind: 'comment' | 'question' | 'redline';
  target: string;
  quote: string;
  before?: string;
  after?: string;
  note: string;
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/modules/review/tests/segments.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/review src/shared/chatDrafts.ts
git commit -m "feat(review): parse doc and feedback blocks from message text"
```

---

### Task 2: Feedback block reader and writer

**Files:**
- Modify: `src/modules/review/parsing/feedback.ts`
- Test: `src/modules/review/tests/feedback.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import { test } from 'vitest';

import { maxMarkNumber, parseFeedbackBody, serializeFeedback } from '@/modules/review/parsing/feedback';
import { parseReviewSegments } from '@/modules/review/parsing/segments';
import type { FeedbackMark } from '@/modules/review/types';

const SPEC_BLOCK = `:::feedback
[m1 comment upload-plan@v1] "Store uploads in the project's .uploads/ folder"
Use files.chiq.me instead, these need to open on my phone.

[m2 redline upload-plan@v1] "Resize images on the client before upload to keep the transcript light."

[m3 question msg:7f3a0000] "up to 5 MB"
Why 5 MB? iPad screenshots are bigger.
:::
Free text typed in the composer follows the block.`;

test('reads the spec example', () => {
  const [feedback, prose] = parseReviewSegments(SPEC_BLOCK);
  assert.ok(feedback.type === 'feedback');
  assert.deepEqual(feedback.marks.map((m) => [m.id, m.kind, m.target]), [
    ['m1', 'comment', 'upload-plan@v1'],
    ['m2', 'redline', 'upload-plan@v1'],
    ['m3', 'question', 'msg:7f3a0000'],
  ]);
  assert.equal(feedback.marks[0].note, 'Use files.chiq.me instead, these need to open on my phone.');
  assert.equal(feedback.marks[1].note, '');
  assert.equal(prose.type === 'markdown' && prose.text, 'Free text typed in the composer follows the block.');
});

test('round-trips marks, including context and awkward notes', () => {
  const marks: FeedbackMark[] = [
    { id: 'm4', kind: 'comment', target: 'a@v2', quote: 'say "hi" twice', before: 'first', after: 'then', note: 'line one\n\nline three' },
    { id: 'm5', kind: 'question', target: 'msg:abcd1234', quote: 'x', note: ':::\n[m9 comment t] "not a header"' },
  ];
  const block = serializeFeedback(marks);
  const [segment] = parseReviewSegments(block);
  assert.ok(segment.type === 'feedback');
  assert.deepEqual(segment.marks, marks);
});

test('writes context only when present', () => {
  const block = serializeFeedback([
    { id: 'm1', kind: 'redline', target: 't@v1', quote: 'q', note: '' },
    { id: 'm2', kind: 'redline', target: 't@v1', quote: 'q', before: 'b', after: 'a', note: '' },
  ]);
  assert.equal(block, ':::feedback\n[m1 redline t@v1] "q"\n\n[m2 redline t@v1] …b "q" a…\n:::');
});

test('garbled bodies are unreadable, not partially read', () => {
  assert.equal(parseFeedbackBody('no header here'), null);
  assert.equal(parseFeedbackBody('[m1 shout t@v1] "q"'), null);
  assert.equal(parseFeedbackBody('[m1 comment t@v1] unquoted'), null);
  assert.equal(parseFeedbackBody(''), null);
});

test('maxMarkNumber scans any text for feedback blocks', () => {
  assert.equal(maxMarkNumber('nothing'), 0);
  assert.equal(maxMarkNumber(SPEC_BLOCK), 3);
  assert.equal(maxMarkNumber(`denied:\n${SPEC_BLOCK}`), 3);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/modules/review/tests/feedback.test.ts`
Expected: FAIL, `serializeFeedback` is not exported.

- [ ] **Step 3: Replace `src/modules/review/parsing/feedback.ts`**

```ts
import { parseReviewSegments } from '@/modules/review/parsing/segments';
import type { FeedbackMark, MarkAnchor, MarkKind } from '@/modules/review/types';

const HEADER = /^\[(m\d+) (comment|question|redline) (\S+)\] (.*)$/;
const ANCHOR = /^(?:…(.*?) )?"(.*)"(?: (.*?)…)?$/;
/** Note lines that would read as structure get one leading space when written. */
const STRUCTURAL_LINE = /^(:::|\[m\d+ )/;
const ESCAPED_STRUCTURAL_LINE = /^ (:::|\[m\d+ )/;

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
/** Context sits outside the quotes, so a `"` in it would confuse the anchor. */
const contextText = (text: string): string => oneLine(text).replace(/"/g, "'");

function readAnchor(raw: string): MarkAnchor | null {
  const match = ANCHOR.exec(raw);
  if (!match) {
    return null;
  }
  return {
    quote: match[2],
    ...(match[1] ? { before: match[1] } : {}),
    ...(match[3] ? { after: match[3] } : {}),
  };
}

/** Reads a `:::feedback` body, or returns null if any part of it is unreadable. */
export function parseFeedbackBody(body: string): FeedbackMark[] | null {
  const marks: Array<FeedbackMark & { noteLines: string[] }> = [];
  for (const line of body.split('\n')) {
    const header = HEADER.exec(line);
    if (header) {
      const anchor = readAnchor(header[4]);
      if (!anchor) {
        return null;
      }
      marks.push({ id: header[1], kind: header[2] as MarkKind, target: header[3], ...anchor, note: '', noteLines: [] });
      continue;
    }
    const current = marks[marks.length - 1];
    if (!current) {
      if (line.trim()) {
        return null;
      }
      continue;
    }
    if (/^\[m\d+ /.test(line)) {
      return null;
    }
    current.noteLines.push(ESCAPED_STRUCTURAL_LINE.test(line) ? line.slice(1) : line);
  }
  if (marks.length === 0) {
    return null;
  }
  return marks.map(({ noteLines, ...mark }) => ({
    ...mark,
    note: noteLines.join('\n').trim(),
  }));
}

function writeMark(mark: FeedbackMark): string {
  const quote = `"${oneLine(mark.quote)}"`;
  const anchor = [
    mark.before ? `…${contextText(mark.before)}` : '',
    quote,
    mark.after ? `${contextText(mark.after)}…` : '',
  ].filter(Boolean).join(' ');
  const header = `[${mark.id} ${mark.kind} ${mark.target}] ${anchor}`;
  if (!mark.note.trim()) {
    return header;
  }
  const note = mark.note
    .trim()
    .split('\n')
    .map((line) => (STRUCTURAL_LINE.test(line) ? ` ${line}` : line))
    .join('\n');
  return `${header}\n${note}`;
}

export function serializeFeedback(marks: FeedbackMark[]): string {
  return `:::feedback\n${marks.map(writeMark).join('\n\n')}\n:::`;
}

/** The highest mark number used by any feedback block in `text`, or 0. */
export function maxMarkNumber(text: string): number {
  let highest = 0;
  for (const segment of parseReviewSegments(text)) {
    if (segment.type === 'feedback') {
      for (const mark of segment.marks) {
        highest = Math.max(highest, Number(mark.id.slice(1)));
      }
    }
  }
  return highest;
}
```

`segments.ts` and `feedback.ts` import each other, but only use each other inside function bodies, so the cycle is safe at load time.

- [ ] **Step 4: Run both parser suites**

Run: `npx vitest run src/modules/review/tests/`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/review
git commit -m "feat(review): read and write feedback rounds"
```

---

### Task 3: Document diff

**Files:**
- Create: `src/modules/review/diff/documentDiff.ts`, `src/modules/review/diff/rehypeReviewMarks.ts`
- Test: `src/modules/review/tests/documentDiff.test.ts`, `src/modules/review/tests/rehypeReviewMarks.test.ts`

- [ ] **Step 1: Write the failing tests**

`documentDiff.test.ts`:

```ts
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
```

`rehypeReviewMarks.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/modules/review/tests/documentDiff.test.ts src/modules/review/tests/rehypeReviewMarks.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `src/modules/review/diff/documentDiff.ts`**

```ts
import { diffArrays, diffWordsWithSpace } from 'diff';

// Private-use characters marking changes inside markdown source. They survive
// the markdown parser as text, and rehypeReviewMarks turns them into elements.
export const INS_OPEN = '';
export const INS_CLOSE = '';
export const DEL_OPEN = '';
export const DEL_CLOSE = '';
const SENTINELS = /[-]/g;

const MAX_BLOCKS_FOR_WORD_DIFF = 2000;
const SIMILARITY_TO_PAIR = 0.4;

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

function similarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
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
  for (const block of removed) {
    let match = -1;
    if (!wholeBlocksOnly && block.kind !== 'table') {
      for (let index = nextAdded; index < added.length; index++) {
        const candidate = added[index];
        if (candidate.kind === block.kind
          && (block.kind === 'code' || similarity(block.text, candidate.text) >= SIMILARITY_TO_PAIR)) {
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
  const before = splitMarkdownBlocks(previous.replace(SENTINELS, ''));
  const after = splitMarkdownBlocks(next.replace(SENTINELS, ''));
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
```

- [ ] **Step 4: Write `src/modules/review/diff/rehypeReviewMarks.ts`**

```ts
import { DEL_CLOSE, DEL_OPEN, INS_CLOSE, INS_OPEN } from '@/modules/review/diff/documentDiff';

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};
type Mode = 'ins' | 'del' | null;

const SPLIT = /([-])/;
const CLASS_NAMES: Record<'ins' | 'del', string[]> = {
  ins: ['rounded-sm', 'bg-emerald-500/20', 'no-underline'],
  del: ['rounded-sm', 'bg-red-500/20', 'line-through', 'opacity-70'],
};

const wrap = (mode: 'ins' | 'del', child: HastNode): HastNode => ({
  type: 'element',
  tagName: mode,
  properties: { className: CLASS_NAMES[mode] },
  children: [child],
});

function nextMode(mode: Mode, sentinel: string): Mode {
  if (sentinel === INS_OPEN) return 'ins';
  if (sentinel === DEL_OPEN) return 'del';
  if (sentinel === INS_CLOSE || sentinel === DEL_CLOSE) return null;
  return mode;
}

/** Rebuilds `<ins>`/`<del>` from the sentinels documentDiff put in the source. */
export function rehypeReviewMarks() {
  return (tree: HastNode) => {
    let mode: Mode = null;

    const walk = (parent: HastNode) => {
      const output: HastNode[] = [];
      for (const child of parent.children ?? []) {
        if (child.type === 'element' && child.tagName === 'code') {
          // CodeBlock expects one string child, so inline code is wrapped whole.
          let wrapMode: Mode = mode;
          const value = (child.children ?? []).map((node) => node.value ?? '').join('');
          const clean = value.split(SPLIT).map((piece) => {
            if (SPLIT.test(piece)) {
              mode = nextMode(mode, piece);
              wrapMode = wrapMode ?? mode;
              return '';
            }
            return piece;
          }).join('');
          const code = { ...child, children: [{ type: 'text', value: clean }] };
          output.push(wrapMode ? wrap(wrapMode, code) : code);
          continue;
        }
        if (child.type === 'text' && typeof child.value === 'string') {
          for (const piece of child.value.split(SPLIT)) {
            if (SPLIT.test(piece)) {
              mode = nextMode(mode, piece);
            } else if (piece) {
              const text = { type: 'text', value: piece };
              output.push(mode ? wrap(mode, text) : text);
            }
          }
          continue;
        }
        if (child.children) {
          walk(child);
        }
        output.push(child);
      }
      parent.children = output;
    };

    walk(tree);
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/modules/review/tests/`
Expected: PASS, 27 tests. If the moved-item test finds the block matched as "changed", the two blocks were similar enough to pair; the fixture uses disjoint words, so re-check `similarity` rather than the test.

- [ ] **Step 6: Commit**

```bash
git add src/modules/review
git commit -m "feat(review): diff document versions by block, word and line"
```

---

### Task 4: Transcript index

**Files:**
- Create: `src/modules/review/state/buildReviewIndex.ts`
- Test: `src/modules/review/tests/buildReviewIndex.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import { test } from 'vitest';

import { buildReviewIndex, reviewFingerprint } from '@/modules/review/state/buildReviewIndex';
import { hashText, messageTarget } from '@/modules/review/parsing/hashText';
import type { ChatMessage } from '@/shared/types';

const assistant = (content: string, extra: Partial<ChatMessage> = {}) =>
  ({ type: 'assistant', content, timestamp: 0, ...extra }) as ChatMessage;
const user = (content: string) => ({ type: 'user', content, timestamp: 0 }) as ChatMessage;
const plan = (toolId: string, text: string, toolResult?: unknown) => ({
  type: 'assistant', content: '', timestamp: 0, isToolUse: true,
  toolName: 'ExitPlanMode', toolId, toolInput: JSON.stringify({ plan: text }), toolResult,
}) as ChatMessage;
const doc = (id: string, body: string, attrs = '') => `:::doc id=${id}${attrs}\n${body}\n:::`;

test('later blocks with the same id are the next versions', () => {
  const first = doc('a', 'one');
  const second = doc('a', 'two', ' addresses=m1');
  const index = buildReviewIndex([assistant(first), user('hm'), assistant(second)]);
  assert.deepEqual(index.versions.get('a')?.map((v) => [v.version, v.body]), [[1, 'one'], [2, 'two']]);
  const located = index.docAt(hashText(second), 0);
  assert.equal(located?.version, 2);
  assert.equal(located?.previousBody, 'one');
  assert.equal(index.docAt(hashText(first), 0)?.previousBody, null);
});

test('blocks in user messages and streaming messages are not versions', () => {
  const index = buildReviewIndex([user(doc('a', 'u')), assistant(doc('a', 's'), { isStreaming: true })]);
  assert.equal(index.versions.size, 0);
});

test('ExitPlanMode plans are versions of the reserved id', () => {
  const index = buildReviewIndex([plan('t1', 'first'), plan('t2', 'second')]);
  assert.deepEqual(index.versions.get('plan')?.map((v) => v.version), [1, 2]);
  assert.equal(index.planAt('t2')?.previousBody, 'first');
  assert.equal(index.planAt('t2')?.version, 2);
});

test('the mark counter follows user messages and denied plans', () => {
  const round = (n: number) => `:::feedback\n[m${n} comment a@v1] "q"\n:::`;
  assert.equal(buildReviewIndex([]).nextMarkNumber, 1);
  assert.equal(buildReviewIndex([user(round(4))]).nextMarkNumber, 5);
  const denied = plan('t1', 'p', { isError: true, content: `prefix\n${round(9)}` });
  assert.equal(buildReviewIndex([user(round(4)), denied]).nextMarkNumber, 10);
});

test('discussions point at marks whose passage still exists', () => {
  const body = 'Keep **bold words** here';
  const source = assistant(doc('a', body));
  const prose = assistant('A reply');
  const target = messageTarget('A reply');
  const feedback = user(
    `:::feedback\n[m1 comment a@v1] "bold words"\nwhy\n\n[m2 question a@v1] "bold words"\nsure?\n\n`
    + `[m3 comment a@v1] "vanished"\n\n[m4 question ${target}] "reply"\n:::`,
  );
  const index = buildReviewIndex([source, prose, feedback]);
  assert.deepEqual(index.discussions.get('a@v1'), [{ quote: 'bold words', markIds: ['m1', 'm2'] }]);
  assert.deepEqual(index.discussions.get(target), [{ quote: 'reply', markIds: ['m4'] }]);
  assert.equal(index.hasPassage('a@v1', 'vanished'), false);
  assert.equal(index.marks.get('m3')?.quote, 'vanished');
});

test('the fingerprint ignores a growing reply but sees a finished one', () => {
  const base = [assistant('done')];
  const streamingA = [...base, assistant('par', { isStreaming: true })];
  const streamingB = [...base, assistant('partial', { isStreaming: true })];
  const finished = [...base, assistant('partial')];
  assert.equal(reviewFingerprint(streamingA), reviewFingerprint(streamingB));
  assert.notEqual(reviewFingerprint(streamingB), reviewFingerprint(finished));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/modules/review/tests/buildReviewIndex.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/modules/review/state/buildReviewIndex.ts`**

```ts
import { maxMarkNumber } from '@/modules/review/parsing/feedback';
import { hashText, messageTarget } from '@/modules/review/parsing/hashText';
import { hasReviewBlock, parseReviewSegments } from '@/modules/review/parsing/segments';
import type { FeedbackMark } from '@/modules/review/types';
import type { ChatMessage } from '@/shared/types';

export type DocVersionInfo = {
  id: string;
  version: number;
  body: string;
  previousBody: string | null;
};
export type Discussion = { quote: string; markIds: string[] };

export type ReviewIndex = {
  versions: Map<string, DocVersionInfo[]>;
  docAt(messageHash: string, ordinal: number): DocVersionInfo | null;
  planAt(toolId: string | undefined): DocVersionInfo | null;
  nextMarkNumber: number;
  marks: Map<string, FeedbackMark>;
  /** Target → passages with later discussion, in first-mentioned order. */
  discussions: Map<string, Discussion[]>;
  hasPassage(target: string, quote: string): boolean;
};

export const EMPTY_REVIEW_INDEX: ReviewIndex = {
  versions: new Map(),
  docAt: () => null,
  planAt: () => null,
  nextMarkNumber: 1,
  marks: new Map(),
  discussions: new Map(),
  hasPassage: () => false,
};

const PLAN_DOC_ID = 'plan';
const isPlanTool = (name: unknown) => name === 'ExitPlanMode' || name === 'exit_plan_mode';

function readPlanText(input: unknown): string | null {
  let parsed = input;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  const plan = (parsed as { plan?: unknown } | null)?.plan;
  return typeof plan === 'string' ? plan.replace(/\\n/g, '\n') : null;
}

/** Strips whitespace and markdown punctuation so source text can match a rendered quote. */
const comparable = (text: string) => text.replace(/[\s*_`#>|[\]()~]/g, '');

/** Changes only when something the index reads has settled, not on each streamed token. */
export function reviewFingerprint(messages: ChatMessage[]): string {
  const parts: string[] = [String(messages.length)];
  for (const message of messages) {
    if (message.isStreaming) {
      parts.push('s');
      continue;
    }
    const content = typeof message.content === 'string' ? message.content.length : 0;
    parts.push(`${content}${message.toolResult ? 'r' : ''}`);
  }
  return parts.join(',');
}

export function buildReviewIndex(messages: ChatMessage[]): ReviewIndex {
  const versions = new Map<string, DocVersionInfo[]>();
  const docLocations = new Map<string, DocVersionInfo>();
  const planLocations = new Map<string, DocVersionInfo>();
  const targetText = new Map<string, string>();
  const feedbackTexts: string[] = [];
  let highestMark = 0;

  const addVersion = (id: string, body: string): DocVersionInfo => {
    const list = versions.get(id) ?? [];
    const info: DocVersionInfo = {
      id,
      version: list.length + 1,
      body,
      previousBody: list.length > 0 ? list[list.length - 1].body : null,
    };
    list.push(info);
    versions.set(id, list);
    targetText.set(`${id}@v${info.version}`, comparable(body));
    return info;
  };

  for (const message of messages) {
    const content = typeof message.content === 'string' ? message.content : '';

    if (isPlanTool(message.toolName)) {
      const plan = readPlanText(message.toolInput);
      if (plan !== null && message.toolId) {
        planLocations.set(message.toolId, addVersion(PLAN_DOC_ID, plan));
      }
      const result = message.toolResult?.content;
      if (typeof result === 'string' && hasReviewBlock(result)) {
        feedbackTexts.push(result);
        highestMark = Math.max(highestMark, maxMarkNumber(result));
      }
      continue;
    }

    if (message.type === 'user' && hasReviewBlock(content)) {
      feedbackTexts.push(content);
      highestMark = Math.max(highestMark, maxMarkNumber(content));
      continue;
    }

    if (message.type !== 'assistant' || message.isThinking || message.isToolUse || message.isStreaming || !content) {
      continue;
    }

    targetText.set(messageTarget(content), comparable(content));
    if (hasReviewBlock(content)) {
      const hash = hashText(content);
      for (const segment of parseReviewSegments(content)) {
        if (segment.type === 'doc') {
          docLocations.set(`${hash}:${segment.ordinal}`, addVersion(segment.id, segment.body));
        }
      }
    }
  }

  const hasPassage = (target: string, quote: string) => {
    const text = targetText.get(target);
    return text !== undefined && text.includes(comparable(quote));
  };

  const marks = new Map<string, FeedbackMark>();
  const discussions = new Map<string, Discussion[]>();
  for (const text of feedbackTexts) {
    for (const segment of parseReviewSegments(text)) {
      if (segment.type !== 'feedback') {
        continue;
      }
      for (const mark of segment.marks) {
        marks.set(mark.id, mark);
        if (!hasPassage(mark.target, mark.quote)) {
          continue;
        }
        const list = discussions.get(mark.target) ?? [];
        const existing = list.find((entry) => entry.quote === mark.quote);
        if (existing) {
          existing.markIds.push(mark.id);
        } else {
          list.push({ quote: mark.quote, markIds: [mark.id] });
        }
        discussions.set(mark.target, list);
      }
    }
  }

  return {
    versions,
    docAt: (messageHash, ordinal) => docLocations.get(`${messageHash}:${ordinal}`) ?? null,
    planAt: (toolId) => (toolId ? planLocations.get(toolId) ?? null : null),
    nextMarkNumber: highestMark + 1,
    marks,
    discussions,
    hasPassage,
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/modules/review/tests/buildReviewIndex.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/review
git commit -m "feat(review): derive versions, mark ids and discussions from the transcript"
```

---

### Task 5: Server storage for unsent marks

**Files:**
- Modify: `server/modules/database/schema.ts:224-233`, `server/modules/database/migrations.ts:522`, `server/modules/database/repositories/session-drafts.db.ts`, `server/modules/user/user.service.ts:10-38,196-221`, `server/modules/user/user.module.ts:52-58`
- Test: `server/modules/database/tests/session-drafts-marks.db.integration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import {
  closeConnection,
  getConnection,
  initializeDatabase,
  sessionDraftsDb,
} from '@/modules/database/index.js';

const USER_ID = 1;
const SCOPE = 'session-1';
const MARKS = [{ key: 'k1', kind: 'comment', target: 'a@v1', quote: 'q', note: 'n' }];

async function withDatabase(prepare: (databasePath: string) => void, run: () => void): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'draft-marks-'));
  const databasePath = path.join(directory, 'auth.db');
  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await writeFile(databasePath, '');
  prepare(databasePath);
  await initializeDatabase();
  getConnection().prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(USER_ID, 'tester', 'hash');
  try {
    run();
  } finally {
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

const fresh = () => {};
const read = () => sessionDraftsDb.getDrafts(USER_ID)[0];

test('migration adds marks to an existing table', async () => {
  await withDatabase((databasePath) => {
    const db = new Database(databasePath);
    db.exec(`CREATE TABLE session_drafts (
      user_id INTEGER NOT NULL, draft_scope TEXT NOT NULL, draft_text TEXT NOT NULL DEFAULT '',
      queued_message TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, draft_scope))`);
    db.close();
  }, () => {
    const columns = getConnection().prepare('PRAGMA table_info(session_drafts)').all() as { name: string }[];
    assert.ok(columns.some((column) => column.name === 'marks'));
  });
});

test('marks round-trip alone and keep the row alive', async () => {
  await withDatabase(fresh, () => {
    sessionDraftsDb.saveDraftMarks(USER_ID, SCOPE, MARKS);
    assert.deepEqual(read().marks, MARKS);
    assert.equal(read().text, '');
  });
});

test('saving text leaves marks alone, and emptying text keeps a row with marks', async () => {
  await withDatabase(fresh, () => {
    sessionDraftsDb.saveDraftMarks(USER_ID, SCOPE, MARKS);
    sessionDraftsDb.saveDraftText(USER_ID, SCOPE, 'typing');
    assert.deepEqual(read().marks, MARKS);
    sessionDraftsDb.saveDraftText(USER_ID, SCOPE, '');
    assert.deepEqual(read().marks, MARKS);
  });
});

test('clearing the last marks removes an otherwise empty row', async () => {
  await withDatabase(fresh, () => {
    sessionDraftsDb.saveDraftMarks(USER_ID, SCOPE, MARKS);
    sessionDraftsDb.saveDraftMarks(USER_ID, SCOPE, []);
    assert.equal(sessionDraftsDb.getDrafts(USER_ID).length, 0);
  });
});

test('saveDraft with nothing left keeps marks', async () => {
  await withDatabase(fresh, () => {
    sessionDraftsDb.saveDraftMarks(USER_ID, SCOPE, MARKS);
    sessionDraftsDb.saveDraft(USER_ID, SCOPE, { text: '', queuedMessage: null });
    assert.deepEqual(read().marks, MARKS);
  });
});

test('an unparseable value counts as no marks', async () => {
  await withDatabase(fresh, () => {
    sessionDraftsDb.saveDraftText(USER_ID, SCOPE, 'x');
    getConnection().prepare('UPDATE session_drafts SET marks = ?').run('{not json');
    assert.deepEqual(read().marks, []);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --tsconfig server/tsconfig.json --test server/modules/database/tests/session-drafts-marks.db.integration.test.ts`
Expected: FAIL, `saveDraftMarks` is not a function and no `marks` column.

- [ ] **Step 3: Add the column**

In `server/modules/database/schema.ts`, in `SESSION_DRAFTS_TABLE_SCHEMA_SQL`, after `queued_message TEXT,` add:

```sql
    marks TEXT,
```

In `server/modules/database/migrations.ts`, immediately after `db.exec(SESSION_DRAFTS_TABLE_SCHEMA_SQL);` add:

```ts
    const sessionDraftColumns = (db.prepare('PRAGMA table_info(session_drafts)').all() as { name: string }[])
      .map((column) => column.name);
    addColumnToTableIfNotExists(db, 'session_drafts', sessionDraftColumns, 'marks', 'TEXT');
```

- [ ] **Step 4: Update the repository**

In `server/modules/database/repositories/session-drafts.db.ts`:

Add to `SessionDraftRecord`, after `queuedMessage: unknown | null;`:

```ts
  /** Review marks waiting in the composer tray. Opaque here; the client owns the shape. */
  marks: unknown[];
```

Add to `DraftRow`, after `queued_message: string | null;`:

```ts
  marks: string | null;
```

Add above `toRecord`:

```ts
/** Stored marks that no longer parse count as none, as with a queued message. */
function parseMarks(raw: string | null): unknown[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
```

In `toRecord`, after `queuedMessage: parseQueuedMessage(row.queued_message),` add:

```ts
    marks: parseMarks(row.marks),
```

In `getDrafts`, change the column list to:

```sql
`SELECT draft_scope, draft_text, queued_message, marks, updated_at
```

In `deleteEmptyDraft`, change the `WHERE` line to:

```sql
         WHERE user_id = ? AND draft_scope = ? AND draft_text = '' AND queued_message IS NULL AND marks IS NULL`
```

In `saveDraft`, replace the empty branch with:

```ts
    if (!draft.text && draft.queuedMessage === null) {
      // Unsent marks are independent of the text and queue, so they keep the row.
      db.prepare(
        `UPDATE session_drafts
         SET draft_text = '', queued_message = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND draft_scope = ?`
      ).run(userId, scope);
      sessionDraftsDb.deleteEmptyDraft(userId, scope);
      return;
    }
```

Add this method after `saveDraftText`:

```ts
  /** Writes one scope's unsent review marks, leaving its text and queue alone. */
  saveDraftMarks(userId: number, scope: string, marks: unknown[]): void {
    const db = getConnection();
    const stored = marks.length > 0 ? JSON.stringify(marks) : null;
    db.transaction(() => {
      db.prepare(
        `INSERT INTO session_drafts (user_id, draft_scope, draft_text, queued_message, marks, updated_at)
         VALUES (?, ?, '', NULL, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, draft_scope) DO UPDATE SET
           marks = excluded.marks,
           updated_at = CURRENT_TIMESTAMP`
      ).run(userId, scope, stored);
      sessionDraftsDb.deleteEmptyDraft(userId, scope);
    })();
  },
```

- [ ] **Step 5: Wire the service**

In `server/modules/user/user.module.ts`, after the `saveDraftText` line add:

```ts
    saveDraftMarks: (userId, scope, marks) => sessionDraftsDb.saveDraftMarks(userId, scope, marks),
```

In `server/modules/user/user.service.ts`, add to the `drafts` dependency type after `saveDraftText(...)`:

```ts
    saveDraftMarks(userId: number, scope: string, marks: unknown[]): void;
```

Add `marks: unknown[];` to the local `DraftRecord` type. In the `saveDraft` service method, change the payload type and add the marks branch just before the `if (payload.queuedMessage === undefined)` comment:

```ts
      const payload = (body ?? {}) as { text?: unknown; queuedMessage?: unknown; marks?: unknown };
```

```ts
      // Marks travel with the debounced save but only when they changed, so a
      // save from a page holding a stale tray cannot overwrite a newer one.
      if (payload.marks !== undefined) {
        if (!Array.isArray(payload.marks) || JSON.stringify(payload.marks).length > MAX_DRAFT_TEXT_LENGTH) {
          throw new AppError('Review marks are invalid or too long to store', {
            code: 'DRAFT_MARKS_INVALID',
            statusCode: 413,
          });
        }
        dependencies.drafts.saveDraftMarks(userId, scope, payload.marks);
      }
```

- [ ] **Step 6: Run server tests for drafts and users**

Run: `npx tsx --tsconfig server/tsconfig.json --test server/modules/database/tests/session-drafts-marks.db.integration.test.ts server/modules/database/tests/user-preferences.db.integration.test.ts "server/modules/user/**/*.test.ts"`
Expected: PASS. If a user-service test builds a fake `drafts` dependency, add `saveDraftMarks: () => {}` to it.

- [ ] **Step 7: Commit**

```bash
git add server/modules/database server/modules/user
git commit -m "feat(drafts): store unsent review marks with the session draft"
```

---

### Task 6: Client draft store for marks

**Files:**
- Modify: `src/shared/chatDrafts.ts`, `src/shared/api.ts:539`
- Test: `src/shared/tests/chatDraftMarks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

import type * as Api from '@/shared/api';

const saved: Array<{ scope: string; text: string; marks?: unknown }> = [];
let serverDrafts: unknown[] = [];
let saveFails = false;

vi.mock('@/shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  api: {
    user: {
      drafts: async () => new Response(JSON.stringify({ success: true, drafts: serverDrafts }), { status: 200 }),
      saveDraft: async (scope: string, draft: { text: string; marks?: unknown }) => {
        saved.push({ scope, ...draft });
        return new Response('{}', { status: saveFails ? 500 : 200 });
      },
    },
  },
}));

const loadStore = async () => {
  vi.resetModules();
  return import('@/shared/chatDrafts');
};
const MARK = { key: 'k1', kind: 'comment' as const, target: 'a@v1', quote: 'q', note: '' };

beforeEach(() => {
  localStorage.clear();
  saved.length = 0;
  serverDrafts = [];
  saveFails = false;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const flush = async () => {
  await vi.advanceTimersByTimeAsync(1_100);
};

test('writes marks to the server, and only for scopes whose marks changed', async () => {
  const store = await loadStore();
  store.writeDraftMarks('s1', [MARK]);
  await flush();
  assert.deepEqual(saved, [{ scope: 's1', text: '', marks: [MARK] }]);
  saved.length = 0;
  store.writeDraftText('s1', 'hello');
  await flush();
  assert.deepEqual(saved, [{ scope: 's1', text: 'hello' }]);
});

test('marks reload from the mirror and from the server', async () => {
  const first = await loadStore();
  first.writeDraftMarks('s1', [MARK]);
  const reloaded = await loadStore();
  assert.deepEqual(reloaded.readDraftMarks('s1'), [MARK]);

  serverDrafts = [{ scope: 's2', text: '', queuedMessage: null, marks: [MARK] }];
  await reloaded.hydrateChatDrafts();
  assert.deepEqual(reloaded.readDraftMarks('s2'), [MARK]);
});

test('hydrate does not replace marks still waiting to be written', async () => {
  const store = await loadStore();
  serverDrafts = [{ scope: 's1', text: '', queuedMessage: null, marks: [] }];
  store.writeDraftMarks('s1', [MARK]);
  await store.hydrateChatDrafts();
  assert.deepEqual(store.readDraftMarks('s1'), [MARK]);
});

test('a failed save is reported and cleared by the next good one', async () => {
  const store = await loadStore();
  saveFails = true;
  store.writeDraftMarks('s1', [MARK]);
  await flush();
  assert.equal(store.didDraftMarksSaveFail('s1'), true);
  assert.deepEqual(store.readDraftMarks('s1'), [MARK]);
  saveFails = false;
  store.writeDraftMarks('s1', []);
  await flush();
  assert.equal(store.didDraftMarksSaveFail('s1'), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/shared/tests/chatDraftMarks.test.ts`
Expected: FAIL, `writeDraftMarks` is not a function.

- [ ] **Step 3: Extend the API type**

In `src/shared/api.ts:539`:

```ts
    saveDraft: (scope: string, draft: { text: string; queuedMessage?: unknown; marks?: unknown }) =>
```

- [ ] **Step 4: Update `src/shared/chatDrafts.ts`**

Replace `DraftRecord`, `EMPTY_DRAFT` and `isEmptyDraft`:

```ts
type DraftRecord = {
  text: string;
  queuedMessage: StoredQueuedMessage | null;
  marks: StoredDraftMark[];
};
```

```ts
const NO_MARKS: StoredDraftMark[] = [];
const EMPTY_DRAFT: DraftRecord = { text: '', queuedMessage: null, marks: NO_MARKS };
```

```ts
const isEmptyDraft = (draft: DraftRecord): boolean => (
  draft.text === '' && draft.queuedMessage === null && draft.marks.length === 0
);

const readStoredMarks = (value: unknown): StoredDraftMark[] => (
  Array.isArray(value) ? value.filter(isRecord) as StoredDraftMark[] : NO_MARKS
);
```

Next to `const pendingScopes = new Set<string>();` add:

```ts
// Scopes whose marks changed here and have not been written yet. Text-only
// saves leave marks out, so a page with a stale tray cannot overwrite them.
const pendingMarkScopes = new Set<string>();
const failedMarkScopes = new Set<string>();
```

In `readMirror`, add to the object passed to `restored.set`:

```ts
        marks: readStoredMarks(value.marks),
```

Replace the body of the `for` loop in `flushServerWrites`:

```ts
    const record = drafts.get(scope);
    const text = record?.text ?? '';
    const sendMarks = pendingMarkScopes.delete(scope);
    const marks = record?.marks ?? NO_MARKS;

    const onFailure = (error: unknown) => {
      console.error('Failed to save chat draft:', error);
      if (sendMarks) {
        failedMarkScopes.add(scope);
        notifyListeners();
      }
    };

    // A save that fails must never surface as an unhandled rejection out of a
    // timer callback: the mirror already holds the draft, and the next
    // keystroke re-sends it.
    try {
      void api.user.saveDraft(scope, sendMarks ? { text, marks } : { text })
        .then((response) => {
          if (sendMarks && !response.ok) {
            onFailure(new Error(`HTTP ${response.status}`));
          } else if (sendMarks && failedMarkScopes.delete(scope)) {
            notifyListeners();
          }
        })
        .catch(onFailure);
    } catch (error) {
      onFailure(error);
    }
```

In `setLocalDraft`, extend the unchanged check:

```ts
  if (next.text === current.text && next.queuedMessage === current.queuedMessage && next.marks === current.marks) {
```

After `writeDraftText` add:

```ts
export function readDraftMarks(scope: string): StoredDraftMark[] {
  return drafts.get(scope)?.marks ?? NO_MARKS;
}

export function writeDraftMarks(scope: string, marks: StoredDraftMark[]): void {
  if (setLocalDraft(scope, { marks })) {
    pendingMarkScopes.add(scope);
    queueServerWrite(scope);
  }
}

/** Whether the last write of this scope's marks failed. They stay in memory. */
export function didDraftMarksSaveFail(scope: string): boolean {
  return failedMarkScopes.has(scope);
}
```

In `hydrateChatDrafts`, change the `serverDrafts` element type to include `marks?: unknown`, and add to the object passed to `merged.set`:

```ts
      marks: readStoredMarks(draft.marks),
```

Add `...pendingMarkScopes,` to the `locallyChangedScopes` set, and add to the `next` record in that loop:

```ts
      marks: pendingMarkScopes.has(scope) ? local.marks : server.marks,
```

In `resetChatDrafts`, after `pendingScopes.clear();` add:

```ts
  pendingMarkScopes.clear();
  failedMarkScopes.clear();
```

- [ ] **Step 5: Run the draft suites**

Run: `npx vitest run src/shared/tests/chatDraftMarks.test.ts src/shared/tests/chatDrafts.test.ts src/modules/chat/tests/composerDraftScoping.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared
git commit -m "feat(drafts): keep unsent review marks in the chat draft store"
```

---

### Task 7: Session instructions

**Files:**
- Create: `server/modules/providers/list/claude/review-instructions.ts`
- Modify: `server/modules/providers/list/claude/claude-runtime.provider.ts:341,406-409`
- Test: `server/modules/providers/tests/claude-review-instructions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { mapCliOptionsToSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import { REVIEW_INSTRUCTIONS } from '@/modules/providers/list/claude/review-instructions.js';

test('interactive runs get the review instructions on the Claude Code preset', () => {
  assert.deepEqual(mapCliOptionsToSDK({ model: 'sonnet' }).systemPrompt, {
    type: 'preset',
    preset: 'claude_code',
    append: REVIEW_INSTRUCTIONS,
  });
});

test('unattended runs get the plain preset', () => {
  assert.deepEqual(mapCliOptionsToSDK({ model: 'sonnet', unattended: true }).systemPrompt, {
    type: 'preset',
    preset: 'claude_code',
  });
});

test('the instructions cover each rule the UI depends on', () => {
  for (const phrase of [':::doc id=', 'addresses=', ':::feedback', 'redline', 'never use the id `plan`']) {
    assert.ok(REVIEW_INSTRUCTIONS.includes(phrase), phrase);
  }
  assert.ok(REVIEW_INSTRUCTIONS.split(/\s+/).length <= 340);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-review-instructions.test.ts`
Expected: FAIL, the module and export do not exist.

- [ ] **Step 3: Write `server/modules/providers/list/claude/review-instructions.ts`**

````ts
/**
 * Appended to Claude Code's system prompt for interactive claudecodeui
 * sessions. It is what makes Claude use the review UI unprompted. The formats
 * here must stay in step with `src/modules/review/parsing/`.
 */
export const REVIEW_INSTRUCTIONS = `# Reviewable documents in this interface

This conversation is displayed in a UI where the user selects passages of your output to comment on them. Use its formats by default, without being asked.

## Documents

Write any plan, spec, draft, report or other text the user may iterate on as a document block:

:::doc id=upload-plan title="Image uploads plan"
...markdown...
:::

- Put \`:::doc\` and the closing \`:::\` each on a line of their own, at the start of the line.
- The id is short and stable, using letters, digits, dots, dashes and underscores. Never use the id \`plan\`; it is reserved.
- To revise a document, write the whole new version in a new block with the same id. The UI shows what changed against the previous version, so never describe the changes inside the block.
- Add \`addresses=m1,m2\` to the opening line, listing the marks that version responds to.
- Do not write a new version when nothing in the document changed.
- Put answers, explanations and questions in prose outside the block. Anything inside the block counts as a change to the document.

Short answers and ordinary conversation are not documents.

## Feedback

The user's messages may start with a block like this:

:::feedback
[m1 comment upload-plan@v1] "the quoted passage"
What the user said about it.

[m2 redline upload-plan@v1] "another passage"

[m3 question msg:7f3a09c1] "a third passage"
What the user asked.
:::

Each mark has an id, a kind, a target (a document version or a message) and the passage it points at. Text after the block is the user's message.

- Address every mark, and refer to marks by id when you discuss them.
- comment: change the document as the user asks.
- redline: remove that passage from the document.
- question: answer in prose. Change the document only if the answer means it should change.

If the marks led to changes in a document, write its next version with \`addresses=\` listing them. One round of feedback produces at most one new version of a document.

A rejected plan may carry a feedback block as its rejection message. Treat it the same way and submit the revised plan.`;
````

- [ ] **Step 4: Apply it**

In `claude-runtime.provider.ts`, add near the other local imports:

```ts
import { REVIEW_INSTRUCTIONS } from '@/modules/providers/list/claude/review-instructions.js';
```

Change `function mapCliOptionsToSDK(` to `export function mapCliOptionsToSDK(`, and replace the `sdkOptions.systemPrompt` assignment at line 406:

```ts
  // An unattended run (the agent API, commit messages) has no reviewer and no
  // UI to read these blocks, so it keeps the stock prompt.
  sdkOptions.systemPrompt = {
    type: 'preset',
    preset: 'claude_code',
    ...(options.unattended ? {} : { append: REVIEW_INSTRUCTIONS }),
  };
```

- [ ] **Step 5: Run provider tests**

Run: `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-review-instructions.test.ts server/modules/providers/tests/claude-runtime-hold.test.ts`
Expected: PASS. The first file may hang after passing if importing the provider leaves a timer; if so, add `--test-force-exit`.

- [ ] **Step 6: Commit**

```bash
git add server/modules/providers
git commit -m "feat(claude): teach interactive sessions the review formats"
```

---

### Task 8: Render documents and feedback in the transcript

**Files:**
- Create: `src/modules/review/state/ReviewContext.tsx`, `src/modules/review/components/{ReviewSegments,DocVersion,FeedbackRound,PassageBadges}.tsx`, `src/modules/review/index.ts`, `src/modules/chat/transcript/reviewMarkdown.tsx`
- Modify: `src/modules/chat/transcript/Markdown.tsx`, `src/modules/chat/transcript/StreamingMarkdown.tsx`, `src/modules/chat/transcript/MessageComponent.tsx`, `src/modules/i18n/locales/en/chat.json`
- Test: `src/modules/review/tests/renderSegments.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { test } from 'vitest';

import ReviewSegments from '@/modules/review/components/ReviewSegments';
import { hashText } from '@/modules/review/parsing/hashText';
import { buildReviewIndex } from '@/modules/review/state/buildReviewIndex';
import { ReviewContext, type ReviewContextValue } from '@/modules/review/state/ReviewContext';
import type { ChatMessage } from '@/shared/types';

const assistant = (content: string) => ({ type: 'assistant', content, timestamp: 0 }) as ChatMessage;
const renderMarkdown = (markdown: string) => <div data-testid="md">{markdown}</div>;

const v1 = ':::doc id=a title="Plan"\nStore files locally today\n:::';
const v2 = ':::doc id=a title="Plan" addresses=m1\nStore files remotely today\n:::';
const context = (messages: ChatMessage[]): ReviewContextValue => ({
  index: buildReviewIndex(messages),
  marks: [],
  saveFailed: false,
  addMark: () => {},
  updateMark: () => {},
  removeMark: () => {},
  composeFeedback: (typed) => typed,
  clearMarks: () => {},
});

const show = (content: string, messages: ChatMessage[], isStreaming = false) => render(
  <ReviewContext.Provider value={context(messages)}>
    <ReviewSegments
      content={content}
      messageHash={hashText(content)}
      isStreaming={isStreaming}
      renderMarkdown={renderMarkdown}
    />
  </ReviewContext.Provider>,
);

test('v1 is a plain card carrying its target', () => {
  const { container } = show(v1, [assistant(v1)]);
  assert.ok(container.querySelector('[data-review-target="a@v1"]'));
  assert.equal(screen.queryByTestId('review-toggle-changes'), null);
  assert.equal(screen.getByTestId('md').textContent, 'Store files locally today');
});

test('v2 marks changes and can hide them', () => {
  const { container } = show(v2, [assistant(v1), assistant(v2)]);
  assert.ok(container.querySelector('[data-review-target="a@v2"]'));
  assert.equal(screen.getByTestId('review-change-count').dataset.changeCount, '1');
  assert.ok(screen.getByTestId('md').textContent?.includes('remotely'));
  fireEvent.click(screen.getByTestId('review-toggle-changes'));
  assert.equal(screen.getByTestId('md').textContent, 'Store files remotely today');
});

test('a version whose predecessor is gone renders as a first version', () => {
  show(v2, [assistant(v2)]);
  assert.equal(screen.queryByTestId('review-toggle-changes'), null);
});

test('an open doc has no target or diff', () => {
  const open = ':::doc id=a\npartial';
  const { container } = show(open, [assistant(v1)], true);
  assert.equal(container.querySelector('[data-review-target]'), null);
  assert.equal(screen.getByTestId('md').textContent, 'partial');
});

test('feedback renders quote cards and flags a lost passage', () => {
  const feedback = ':::feedback\n[m1 comment a@v1] "Store files"\nnote\n\n[m2 redline a@v1] "not there"\n:::';
  const { container } = show(feedback, [assistant(v1)]);
  assert.ok(container.querySelector('#review-mark-m1'));
  assert.equal(screen.queryByTestId('review-mark-lost-m1'), null);
  assert.ok(screen.getByTestId('review-mark-lost-m2'));
});

test('malformed blocks render as markdown with a note and nothing throws', () => {
  show(':::doc title="no id"\nbody\n:::', []);
  assert.ok(screen.getByTestId('review-malformed'));
  assert.ok(screen.getByTestId('md').textContent?.includes('no id'));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/modules/review/tests/renderSegments.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the context**

`src/modules/review/state/ReviewContext.tsx`:

```tsx
import { createContext, useContext } from 'react';

import type { ReviewIndex } from '@/modules/review/state/buildReviewIndex';
import type { DraftMark } from '@/modules/review/types';

export type NewDraftMark = Omit<DraftMark, 'key'>;

export type ReviewContextValue = {
  index: ReviewIndex;
  marks: DraftMark[];
  saveFailed: boolean;
  addMark(mark: NewDraftMark): void;
  updateMark(key: string, note: string): void;
  removeMark(key: string): void;
  /** The text to send: a feedback block for the tray's marks, then what was typed. */
  composeFeedback(typed: string): string;
  clearMarks(): void;
};

export const ReviewContext = createContext<ReviewContextValue | null>(null);

export const useReview = (): ReviewContextValue | null => useContext(ReviewContext);
```

- [ ] **Step 4: Write the components**

`src/modules/review/components/DocVersion.tsx`:

```tsx
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { diffDocument, type CodeLine, type DiffRun } from '@/modules/review/diff/documentDiff';
import { rehypeReviewMarks } from '@/modules/review/diff/rehypeReviewMarks';
import { scrollToReviewElement } from '@/modules/review/components/FeedbackRound';

export type RenderMarkdown = (
  markdown: string,
  options?: { rehypePlugins?: unknown[]; streaming?: boolean },
) => ReactNode;

type DocVersionProps = {
  id: string;
  title?: string;
  addresses?: string[];
  body: string;
  version: number | null;
  previousBody: string | null;
  open?: boolean;
  /** Drops the card chrome when something else (the plan card) provides it. */
  bare?: boolean;
  renderMarkdown: RenderMarkdown;
};

const REVIEW_REHYPE_PLUGINS = [rehypeReviewMarks];
const LINE_STYLES: Record<CodeLine['status'], string> = {
  same: '',
  added: 'bg-emerald-500/20',
  removed: 'bg-red-500/20 line-through opacity-70',
};

function DiffRunView({ run, renderMarkdown }: { run: DiffRun; renderMarkdown: RenderMarkdown }) {
  if (run.type === 'markdown') {
    return <>{renderMarkdown(run.markdown, { rehypePlugins: REVIEW_REHYPE_PLUGINS })}</>;
  }
  if (run.type === 'block') {
    return (
      <div className={`my-2 rounded-md ${run.status === 'added' ? 'bg-emerald-500/10' : 'bg-red-500/10 opacity-70'}`}>
        {renderMarkdown(run.markdown)}
      </div>
    );
  }
  return (
    <pre className="my-3 overflow-x-auto rounded-xl border border-border bg-muted/50 p-3 font-mono text-[0.8125rem] leading-relaxed">
      {run.lines.map((line, index) => (
        <div key={index} className={LINE_STYLES[line.status]}>{line.text || ' '}</div>
      ))}
    </pre>
  );
}

export default function DocVersion({
  id, title, addresses = [], body, version, previousBody, open = false, bare = false, renderMarkdown,
}: DocVersionProps) {
  const { t } = useTranslation('chat');
  const [changesHidden, setChangesHidden] = useState(false);
  const diff = useMemo(
    () => (previousBody !== null && !open ? diffDocument(previousBody, body) : null),
    [body, open, previousBody],
  );
  const target = !open && version !== null ? `${id}@v${version}` : undefined;
  const showDiff = diff !== null && !changesHidden;

  return (
    <div
      data-review-target={target}
      className={bare ? '' : 'not-prose my-3 rounded-xl border border-border bg-card p-4 font-sans'}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-review-chrome>
        {!bare && <span className="text-sm font-semibold text-foreground">{title ?? id}</span>}
        {version !== null && <span>v{version}</span>}
        {diff && (
          <span data-testid="review-change-count" data-change-count={diff.changeCount}>
            {t('review.changes', { count: diff.changeCount, defaultValue: '{{count}} changes' })}
          </span>
        )}
        {addresses.map((markId) => (
          <button
            key={markId}
            type="button"
            onClick={() => scrollToReviewElement(`review-mark-${markId}`)}
            className="rounded-full border border-border px-2 py-0.5 hover:bg-accent"
          >
            {markId}
          </button>
        ))}
        {diff && (
          <button
            type="button"
            data-testid="review-toggle-changes"
            onClick={() => setChangesHidden((hidden) => !hidden)}
            className="ml-auto rounded-md px-2 py-0.5 hover:bg-accent"
          >
            {changesHidden
              ? t('review.showChanges', 'Show changes')
              : t('review.hideChanges', 'Hide changes')}
          </button>
        )}
      </div>
      <div className="prose prose-sm max-w-none dark:prose-invert">
        {showDiff
          ? diff.runs.map((run, index) => <DiffRunView key={index} run={run} renderMarkdown={renderMarkdown} />)
          : renderMarkdown(body, { streaming: open })}
      </div>
    </div>
  );
}
```

`src/modules/review/components/FeedbackRound.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

import { useReview } from '@/modules/review/state/ReviewContext';
import type { FeedbackMark, MarkKind } from '@/modules/review/types';

const KIND_STYLES: Record<MarkKind, string> = {
  comment: 'border-l-blue-500',
  question: 'border-l-violet-500',
  redline: 'border-l-red-500',
};

export function scrollToReviewElement(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function scrollToTarget(target: string): void {
  document
    .querySelector(`[data-review-target="${CSS.escape(target)}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export default function FeedbackRound({ marks }: { marks: FeedbackMark[] }) {
  const { t } = useTranslation('chat');
  const review = useReview();

  return (
    <div className="not-prose my-1 flex flex-col gap-2 text-left font-sans">
      {marks.map((mark) => {
        const lost = review !== null && !review.index.hasPassage(mark.target, mark.quote);
        return (
          <div
            key={mark.id}
            id={`review-mark-${mark.id}`}
            className={`rounded-md border-l-2 bg-background/60 px-3 py-2 text-xs ${KIND_STYLES[mark.kind]}`}
          >
            <button
              type="button"
              disabled={lost}
              onClick={() => scrollToTarget(mark.target)}
              className="block w-full text-left italic text-muted-foreground enabled:hover:text-foreground"
            >
              <span className="mr-1 font-mono not-italic">{mark.id} · {t(`review.kind.${mark.kind}`, mark.kind)}</span>
              “{mark.quote}”
            </button>
            {mark.note && <div className="mt-1 whitespace-pre-wrap text-sm text-foreground">{mark.note}</div>}
            {lost && (
              <div data-testid={`review-mark-lost-${mark.id}`} className="mt-1 text-muted-foreground">
                {t('review.passageLost', 'Passage no longer in the conversation')}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

`src/modules/review/components/ReviewSegments.tsx`:

```tsx
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import DocVersion, { type RenderMarkdown } from '@/modules/review/components/DocVersion';
import FeedbackRound from '@/modules/review/components/FeedbackRound';
import { parseReviewSegments } from '@/modules/review/parsing/segments';
import { useReview } from '@/modules/review/state/ReviewContext';

type ReviewSegmentsProps = {
  content: string;
  /** Hash of the raw message text, which is how the index finds this message's docs. */
  messageHash: string;
  isStreaming: boolean;
  renderMarkdown: RenderMarkdown;
};

/** Used by chat's StreamingMarkdown and user bubble for any message with review blocks. */
export default function ReviewSegments({ content, messageHash, isStreaming, renderMarkdown }: ReviewSegmentsProps) {
  const { t } = useTranslation('chat');
  const review = useReview();
  const segments = useMemo(
    () => parseReviewSegments(content, { streaming: isStreaming }),
    [content, isStreaming],
  );

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === 'markdown') {
          return <div key={index}>{renderMarkdown(segment.text)}</div>;
        }
        if (segment.type === 'feedback') {
          return <FeedbackRound key={index} marks={segment.marks} />;
        }
        if (segment.type === 'malformed') {
          return (
            <div key={index}>
              {renderMarkdown(segment.raw)}
              <div data-testid="review-malformed" className="mt-1 text-xs text-muted-foreground">
                {t('review.malformed', "Couldn't read this block")}
              </div>
            </div>
          );
        }
        const info = segment.open ? null : review?.index.docAt(messageHash, segment.ordinal) ?? null;
        return (
          <DocVersion
            key={index}
            id={segment.id}
            title={segment.title}
            addresses={segment.addresses}
            body={segment.body}
            version={segment.open ? null : info?.version ?? 1}
            previousBody={info?.previousBody ?? null}
            open={segment.open}
            renderMarkdown={renderMarkdown}
          />
        );
      })}
    </>
  );
}
```

`src/modules/review/components/PassageBadges.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

import { scrollToReviewElement } from '@/modules/review/components/FeedbackRound';
import { useReview } from '@/modules/review/state/ReviewContext';

/** Under a message or document: one chip per passage discussed later. */
export default function PassageBadges({ target }: { target: string }) {
  const { t } = useTranslation('chat');
  const discussions = useReview()?.index.discussions.get(target);
  if (!discussions?.length) {
    return null;
  }
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 font-sans text-xs">
      {discussions.map((discussion) => (
        <button
          key={discussion.quote}
          type="button"
          onClick={() => scrollToReviewElement(`review-mark-${discussion.markIds[0]}`)}
          className="max-w-xs truncate rounded-full border border-border px-2 py-0.5 text-muted-foreground hover:bg-accent"
        >
          “{discussion.quote}” ·{' '}
          {t('review.discussions', { count: discussion.markIds.length, defaultValue: '{{count}} discussions' })}
        </button>
      ))}
    </div>
  );
}
```

`src/modules/review/index.ts`:

```ts
export { default as ReviewSegments } from '@/modules/review/components/ReviewSegments';
export { default as DocVersion } from '@/modules/review/components/DocVersion';
export type { RenderMarkdown } from '@/modules/review/components/DocVersion';
export { default as PassageBadges } from '@/modules/review/components/PassageBadges';
export { hashText, messageTarget } from '@/modules/review/parsing/hashText';
export { hasReviewBlock } from '@/modules/review/parsing/segments';
export { ReviewContext, useReview } from '@/modules/review/state/ReviewContext';
```

- [ ] **Step 5: Let `MarkdownBody` take extra rehype plugins**

In `src/modules/chat/transcript/Markdown.tsx`, add to `MarkdownProps`:

```ts
  /** Extra rehype plugins. Pass a stable array: it is a memo dependency. */
  rehypePlugins?: unknown[];
```

Change the renderer's signature:

```ts
function MarkdownBodyRenderer({ children, breaks = false, rehypePlugins: extraRehypePlugins }: Omit<MarkdownProps, 'className'>) {
```

Replace the `rehypePlugins` memo:

```ts
  const rehypePlugins = useMemo(() => {
    if (!hasMath && !extraRehypePlugins) {
      return EMPTY_PLUGINS;
    }
    return [...(hasMath ? [rehypeKatex] : []), ...(extraRehypePlugins ?? [])] as any;
  }, [extraRehypePlugins, hasMath]);
```

- [ ] **Step 6: Create the chat-side renderer**

`src/modules/chat/transcript/reviewMarkdown.tsx`:

```tsx
import { MarkdownBody } from '@/modules/chat/transcript/Markdown';
import StreamingMarkdown from '@/modules/chat/transcript/StreamingMarkdown';
import type { RenderMarkdown } from '@/modules/review';

/** Handed to the review module so it can render markdown without importing chat. */
export const renderReviewMarkdown: RenderMarkdown = (markdown, options) => (
  options?.streaming
    ? <StreamingMarkdown content={markdown} isStreaming />
    : <MarkdownBody rehypePlugins={options?.rehypePlugins}>{markdown}</MarkdownBody>
);
```

- [ ] **Step 7: Route assistant messages through it**

In `src/modules/chat/transcript/StreamingMarkdown.tsx`, add the imports:

```tsx
import { ReviewSegments, hasReviewBlock, hashText, messageTarget } from '@/modules/review';
import { renderReviewMarkdown } from '@/modules/chat/transcript/reviewMarkdown';
```

Add to the props type:

```ts
  /**
   * The message's raw text. Passing it enables review features: selections
   * target this message, and `:::doc` blocks render as documents.
   */
  reviewSourceText?: string;
```

Replace the component body with:

```tsx
export default function StreamingMarkdown({
  content,
  isStreaming,
  className,
  reviewSourceText,
}: StreamingMarkdownProps) {
  // Never split a message holding a review block: a boundary inside `:::doc`
  // would render its two halves as separate markdown.
  const hasBlocks = useMemo(
    () => reviewSourceText !== undefined && hasReviewBlock(content),
    [content, reviewSourceText],
  );
  const { settled, pending } = useMemo(
    () => (isStreaming && !hasBlocks ? splitStreamingMarkdown(content) : { settled: content, pending: '' }),
    [content, hasBlocks, isStreaming],
  );
  const target = reviewSourceText !== undefined && !isStreaming ? messageTarget(reviewSourceText) : undefined;

  if (hasBlocks) {
    return (
      <div className={className} data-review-target={target}>
        <ReviewSegments
          content={content}
          messageHash={hashText(reviewSourceText ?? content)}
          isStreaming={isStreaming}
          renderMarkdown={renderReviewMarkdown}
        />
      </div>
    );
  }

  return (
    <div className={className} data-review-target={target}>
      {settled && <MarkdownBody>{settled}</MarkdownBody>}
      {pending && <MarkdownBody>{pending}</MarkdownBody>}
    </div>
  );
}
```

`StreamingMarkdown.tsx` and `reviewMarkdown.tsx` import each other, each using the other only at render time, so the cycle is safe.

In `src/modules/chat/transcript/MessageComponent.tsx`, add:

```tsx
import { PassageBadges, ReviewSegments, hasReviewBlock, hashText, messageTarget } from '@/modules/review';
import { renderReviewMarkdown } from '@/modules/chat/transcript/reviewMarkdown';
```

Replace the assistant branch at line 391 (`return message.type === 'assistant' ? (` through its `StreamingMarkdown`):

```tsx
                  return message.type === 'assistant' ? (
                    <>
                      <StreamingMarkdown
                        content={content}
                        isStreaming={Boolean(message.isStreaming)}
                        reviewSourceText={String(message.content || '')}
                        className="prose prose-sm prose-gray max-w-none font-serif dark:prose-invert"
                      />
                      {!message.isStreaming && <PassageBadges target={messageTarget(String(message.content || ''))} />}
                    </>
                  ) : (
```

Replace the user bubble's `<Markdown breaks …>{message.content}</Markdown>` (lines 116-121):

```tsx
                  {hasReviewBlock(String(message.content || '')) ? (
                    <div className="prose prose-sm max-w-none font-serif dark:prose-invert">
                      <ReviewSegments
                        content={String(message.content)}
                        messageHash={hashText(String(message.content))}
                        isStreaming={false}
                        renderMarkdown={renderReviewMarkdown}
                      />
                    </div>
                  ) : (
                    <Markdown
                      breaks
                      className="prose prose-sm max-w-none font-serif dark:prose-invert"
                    >
                      {message.content}
                    </Markdown>
                  )}
```

- [ ] **Step 8: Add the English strings**

In `src/modules/i18n/locales/en/chat.json`, add a top-level `"review"` object next to `"misc"`:

```json
  "review": {
    "changes_one": "{{count}} change",
    "changes_other": "{{count}} changes",
    "showChanges": "Show changes",
    "hideChanges": "Hide changes",
    "discussions_one": "{{count}} discussion",
    "discussions_other": "{{count}} discussions",
    "malformed": "Couldn't read this block",
    "passageLost": "Passage no longer in the conversation",
    "kind": { "comment": "comment", "question": "question", "redline": "redline" },
    "comment": "Comment",
    "ask": "Ask",
    "redline": "Redline",
    "commentPlaceholder": "Add a comment…",
    "askPlaceholder": "Ask about this…",
    "add": "Add",
    "cancel": "Cancel",
    "remove": "Remove",
    "marksSaveFailed": "Couldn't save these marks. They'll be lost if you reload."
  },
```

Other locales fall back to English, as with other new strings.

- [ ] **Step 9: Run the rendering and streaming suites**

Run: `npx vitest run src/modules/review/tests/ src/modules/chat/tests/streamingMarkdownComponent.test.tsx src/modules/chat/tests/streamingMarkdownRenderEquivalence.test.tsx`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/modules/review src/modules/chat/transcript src/modules/i18n/locales/en/chat.json
git commit -m "feat(review): render versioned documents and feedback rounds in the transcript"
```

---

### Task 9: Review session state

**Files:**
- Create: `src/modules/review/state/useReviewSession.ts`
- Modify: `src/modules/review/index.ts`, `src/modules/chat/ChatInterface.tsx`
- Test: `src/modules/review/tests/useReviewSession.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import { useReviewSession } from '@/modules/review/state/useReviewSession';
import type { ChatMessage } from '@/shared/types';

const store = vi.hoisted(() => ({
  marks: new Map<string, unknown[]>(),
  // One array: useSyncExternalStore needs a stable snapshot, as the real store gives.
  noMarks: [] as unknown[],
  queued: null as { content: string } | null,
  listeners: new Set<() => void>(),
}));

vi.mock('@/shared/chatDrafts', () => ({
  readDraftMarks: (scope: string) => store.marks.get(scope) ?? store.noMarks,
  writeDraftMarks: (scope: string, marks: unknown[]) => {
    store.marks.set(scope, marks);
    store.listeners.forEach((listener) => listener());
  },
  didDraftMarksSaveFail: () => false,
  readQueuedMessage: () => store.queued,
  subscribeToChatDrafts: (listener: () => void) => {
    store.listeners.add(listener);
    return () => store.listeners.delete(listener);
  },
}));

const NEW_MARK = { kind: 'comment' as const, target: 'a@v1', quote: 'q', note: 'fix' };
const user = (content: string) => ({ type: 'user', content, timestamp: 0 }) as ChatMessage;

beforeEach(() => {
  store.marks.clear();
  store.queued = null;
});

const session = (messages: ChatMessage[] = []) => renderHook(() => useReviewSession(messages, 's1')).result;

test('marks persist through the draft store', () => {
  const result = session();
  act(() => result.current.addMark(NEW_MARK));
  assert.equal(result.current.marks.length, 1);
  assert.equal((store.marks.get('s1') as any[]).length, 1);
  const { key } = result.current.marks[0];
  act(() => result.current.updateMark(key, 'edited'));
  assert.equal(result.current.marks[0].note, 'edited');
  act(() => result.current.removeMark(key));
  assert.equal(result.current.marks.length, 0);
});

test('composes the exact block ahead of the typed text', () => {
  const result = session();
  act(() => result.current.addMark(NEW_MARK));
  assert.equal(
    result.current.composeFeedback('and also this'),
    ':::feedback\n[m1 comment a@v1] "q"\nfix\n:::\nand also this',
  );
});

test('numbers after the transcript and after a queued round', () => {
  const sent = user(':::feedback\n[m3 comment a@v1] "q"\n:::');
  store.queued = { content: ':::feedback\n[m7 comment a@v1] "q"\n:::' };
  const result = session([sent]);
  act(() => result.current.addMark(NEW_MARK));
  assert.ok(result.current.composeFeedback('').includes('[m8 comment'));
});

test('with no marks the text passes through', () => {
  assert.equal(session().current.composeFeedback('hello'), 'hello');
});

test('clearMarks empties the tray', () => {
  const result = session();
  act(() => result.current.addMark(NEW_MARK));
  act(() => result.current.clearMarks());
  assert.deepEqual(result.current.marks, []);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/modules/review/tests/useReviewSession.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/modules/review/state/useReviewSession.ts`**

```ts
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';

import { maxMarkNumber, serializeFeedback } from '@/modules/review/parsing/feedback';
import {
  EMPTY_REVIEW_INDEX,
  buildReviewIndex,
  reviewFingerprint,
  type ReviewIndex,
} from '@/modules/review/state/buildReviewIndex';
import type { NewDraftMark, ReviewContextValue } from '@/modules/review/state/ReviewContext';
import type { DraftMark } from '@/modules/review/types';
import {
  didDraftMarksSaveFail,
  readDraftMarks,
  readQueuedMessage,
  subscribeToChatDrafts,
  writeDraftMarks,
} from '@/shared/chatDrafts';
import type { ChatMessage } from '@/shared/types';

const NO_MARKS: DraftMark[] = [];

/** Called by ChatInterface, once per open chat. The result feeds ReviewContext and the composer. */
export function useReviewSession(messages: ChatMessage[], scope: string | null): ReviewContextValue {
  // Keyed on settled content so a streaming reply does not rebuild the index,
  // and with it re-render every review consumer, ten times a second.
  const fingerprint = reviewFingerprint(messages);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const index: ReviewIndex = useMemo(
    () => (messagesRef.current.length ? buildReviewIndex(messagesRef.current) : EMPTY_REVIEW_INDEX),
    [fingerprint],
  );

  const marks = useSyncExternalStore(
    subscribeToChatDrafts,
    () => (scope ? readDraftMarks(scope) : NO_MARKS),
  );
  const saveFailed = useSyncExternalStore(
    subscribeToChatDrafts,
    () => (scope ? didDraftMarksSaveFail(scope) : false),
  );

  const write = useCallback((update: (current: DraftMark[]) => DraftMark[]) => {
    if (scope) {
      writeDraftMarks(scope, update(readDraftMarks(scope)));
    }
  }, [scope]);

  const addMark = useCallback((mark: NewDraftMark) => {
    write((current) => [...current, { ...mark, key: crypto.randomUUID() }]);
  }, [write]);

  const updateMark = useCallback((key: string, note: string) => {
    write((current) => current.map((mark) => (mark.key === key ? { ...mark, note } : mark)));
  }, [write]);

  const removeMark = useCallback((key: string) => {
    write((current) => current.filter((mark) => mark.key !== key));
  }, [write]);

  const clearMarks = useCallback(() => write(() => []), [write]);

  const composeFeedback = useCallback((typed: string) => {
    const current = scope ? readDraftMarks(scope) : NO_MARKS;
    if (current.length === 0) {
      return typed;
    }
    const queued = scope ? readQueuedMessage(scope)?.content ?? '' : '';
    const firstNumber = Math.max(index.nextMarkNumber, maxMarkNumber(queued) + 1);
    const block = serializeFeedback(current.map(({ key: _key, ...mark }, position) => ({
      ...mark,
      id: `m${firstNumber + position}`,
    })));
    return typed.trim() ? `${block}\n${typed}` : block;
  }, [index, scope]);

  return useMemo(
    () => ({ index, marks, saveFailed, addMark, updateMark, removeMark, composeFeedback, clearMarks }),
    [addMark, clearMarks, composeFeedback, index, marks, removeMark, saveFailed, updateMark],
  );
}
```

Add to `src/modules/review/index.ts`:

```ts
export { useReviewSession } from '@/modules/review/state/useReviewSession';
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/modules/review/tests/useReviewSession.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Provide the session in `ChatInterface`**

In `src/modules/chat/ChatInterface.tsx`:

Add the import:

```tsx
import { ReviewContext, hasReviewBlock, useReviewSession } from '@/modules/review';
```

Immediately before the `useChatComposerState({` call at line 241, add:

```tsx
  const review = useReviewSession(chatMessages, selectedSession?.id ?? currentSessionId ?? null);

  // Versions and mark ids count across the whole session, but only the latest
  // page is loaded at first. Once review content shows up, load the rest so a
  // v3 is not numbered v1. Once per session, so a failed load cannot loop.
  const reviewHistoryLoadedForRef = useRef<string | null>(null);
  const reviewContentPresent = review.marks.length > 0
    || chatMessages.some((message) => typeof message.content === 'string' && hasReviewBlock(message.content));
  useEffect(() => {
    const sessionId = selectedSession?.id;
    if (!sessionId || !hasMoreMessages || !reviewContentPresent) {
      return;
    }
    if (reviewHistoryLoadedForRef.current !== sessionId) {
      reviewHistoryLoadedForRef.current = sessionId;
      void loadAllMessages();
    }
  }, [hasMoreMessages, loadAllMessages, reviewContentPresent, selectedSession?.id]);
```

Add `review,` to the arguments passed to `useChatComposerState` (declared in Task 12). Add `useEffect` and `useRef` to the React import if absent.

Wrap the outermost element returned by the component:

```tsx
    <ReviewContext.Provider value={review}>
      <PermissionContext.Provider value={permissionContextValue}>
        {/* existing content unchanged */}
      </PermissionContext.Provider>
    </ReviewContext.Provider>
```

Until Task 12, TypeScript will report `review` as an unknown property; the next tasks resolve it, and vitest does not typecheck.

- [ ] **Step 6: Commit**

```bash
git add src/modules/review src/modules/chat/ChatInterface.tsx
git commit -m "feat(review): hold the review session for the open chat"
```

---

### Task 10: Selecting passages

**Files:**
- Create: `src/modules/review/selection/resolveSelection.ts`, `src/modules/review/components/SelectionToolbar.tsx`
- Modify: `src/modules/review/index.ts`, `src/modules/chat/ChatInterface.tsx`
- Test: `src/modules/review/tests/selection.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

import SelectionToolbar from '@/modules/review/components/SelectionToolbar';
import { resolveSelection } from '@/modules/review/selection/resolveSelection';
import { EMPTY_REVIEW_INDEX } from '@/modules/review/state/buildReviewIndex';
import { ReviewContext, type ReviewContextValue } from '@/modules/review/state/ReviewContext';

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = '';
});

function select(startNode: Node, startOffset: number, endNode: Node, endOffset: number): Selection {
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

test('resolves the quote and the nearest target', () => {
  const host = mount('<div data-review-target="msg:1"><div data-review-target="a@v2"><p>hello big world</p></div></div>');
  const text = host.querySelector('p')!.firstChild!;
  assert.deepEqual(resolveSelection(select(text, 6, text, 9)), { target: 'a@v2', quote: 'big' });
});

test('adds context only for an ambiguous quote', () => {
  const host = mount('<div data-review-target="msg:1"><p>one word then another word again</p></div>');
  const text = host.querySelector('p')!.firstChild!;
  assert.deepEqual(resolveSelection(select(text, 22, text, 26)), {
    target: 'msg:1',
    quote: 'word',
    before: 'one word then another',
    after: 'again',
  });
});

test('refuses selections outside a target, across targets, or collapsed', () => {
  const host = mount('<p id="o">outside</p><div data-review-target="a@v1"><p id="a">aaa</p></div><div data-review-target="b@v1"><p id="b">bbb</p></div>');
  const textOf = (id: string) => host.querySelector(`#${id}`)!.firstChild!;
  assert.equal(resolveSelection(select(textOf('o'), 0, textOf('o'), 3)), null);
  assert.equal(resolveSelection(select(textOf('a'), 0, textOf('b'), 1)), null);
  assert.equal(resolveSelection(select(textOf('a'), 1, textOf('a'), 1)), null);
});

test('deleted text and card chrome are not part of the quote', () => {
  const host = mount('<div data-review-target="a@v2"><div data-review-chrome>v2</div><p>keep <del>gone </del>more</p></div>');
  const paragraph = host.querySelector('p')!;
  assert.deepEqual(resolveSelection(select(paragraph.firstChild!, 0, paragraph.lastChild!, 4)), {
    target: 'a@v2',
    quote: 'keep more',
  });
});

test('toolbar: redline adds at once, comment opens a popover', async () => {
  const addMark = vi.fn();
  const value = { index: EMPTY_REVIEW_INDEX, marks: [], addMark } as unknown as ReviewContextValue;
  const host = mount('<div data-review-target="a@v1"><p>hello world</p></div>');
  render(<ReviewContext.Provider value={value}><SelectionToolbar /></ReviewContext.Provider>);
  const text = host.querySelector('p')!.firstChild!;

  select(text, 0, text, 5);
  fireEvent(document, new Event('selectionchange'));
  fireEvent.click(await screen.findByTestId('review-redline'));
  assert.deepEqual(addMark.mock.calls[0][0], { kind: 'redline', target: 'a@v1', quote: 'hello', note: '' });

  select(text, 6, text, 11);
  fireEvent(document, new Event('selectionchange'));
  fireEvent.click(await screen.findByTestId('review-comment'));
  fireEvent.change(screen.getByTestId('review-note'), { target: { value: 'why' } });
  fireEvent.click(screen.getByTestId('review-note-add'));
  assert.deepEqual(addMark.mock.calls[1][0], { kind: 'comment', target: 'a@v1', quote: 'world', note: 'why' });
});
```

The toolbar reads `range.getBoundingClientRect`, which jsdom does not implement on `Range`. Add this at the top of the test file, below the imports:

```ts
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/modules/review/tests/selection.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `src/modules/review/selection/resolveSelection.ts`**

```ts
import type { MarkAnchor } from '@/modules/review/types';

export type ResolvedSelection = MarkAnchor & { target: string };

const CONTEXT_CHARACTERS = 24;
const EXCLUDED = 'del, [data-review-chrome]';

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
const squash = (text: string) => text.replace(/\s+/g, '');

const closestTarget = (node: Node | null): HTMLElement | null => {
  const element = node instanceof Element ? node : node?.parentElement ?? null;
  return element?.closest<HTMLElement>('[data-review-target]') ?? null;
};

/** Text in a range, leaving out deleted text and card chrome. */
function rangeText(range: Range): string {
  const fragment = range.cloneContents();
  const hadExcluded = fragment.querySelector(EXCLUDED) !== null;
  fragment.querySelectorAll(EXCLUDED).forEach((element) => element.remove());
  return hadExcluded ? fragment.textContent ?? '' : range.toString();
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
    count += 1;
  }
  return count;
}

/** Turns the browser selection into a mark's target and anchor, or null if it can't be marked. */
export function resolveSelection(selection: Selection | null): ResolvedSelection | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const target = closestTarget(range.startContainer);
  if (!target || target !== closestTarget(range.endContainer)) {
    return null;
  }
  const targetId = target.dataset.reviewTarget;
  const quote = oneLine(rangeText(range));
  if (!targetId || !quote) {
    return null;
  }

  const whole = document.createRange();
  whole.selectNodeContents(target);
  if (countOccurrences(squash(rangeText(whole)), squash(quote)) <= 1) {
    return { target: targetId, quote };
  }

  const beforeRange = whole.cloneRange();
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const afterRange = whole.cloneRange();
  afterRange.setStart(range.endContainer, range.endOffset);
  const before = oneLine(oneLine(rangeText(beforeRange)).slice(-CONTEXT_CHARACTERS));
  const after = oneLine(oneLine(rangeText(afterRange)).slice(0, CONTEXT_CHARACTERS));
  return {
    target: targetId,
    quote,
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
  };
}
```

- [ ] **Step 4: Write `src/modules/review/components/SelectionToolbar.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveSelection, type ResolvedSelection } from '@/modules/review/selection/resolveSelection';
import { useReview } from '@/modules/review/state/ReviewContext';
import type { MarkKind } from '@/modules/review/types';

type Anchored = { selection: ResolvedSelection; top: number; left: number };

const TOOLBAR_OFFSET = 44;

function readAnchored(): Anchored | null {
  const domSelection = window.getSelection();
  const selection = resolveSelection(domSelection);
  if (!selection || !domSelection) {
    return null;
  }
  const rect = domSelection.getRangeAt(0).getBoundingClientRect();
  // Touch devices draw their own menu above a selection, so go below it there.
  const below = window.matchMedia('(pointer: coarse)').matches;
  return {
    selection,
    top: below ? rect.bottom + 12 : Math.max(8, rect.top - TOOLBAR_OFFSET),
    left: Math.max(8, rect.left),
  };
}

/** Mounted once by ChatInterface; floats over any selection in an assistant message. */
export default function SelectionToolbar() {
  const { t } = useTranslation('chat');
  const review = useReview();
  const [anchored, setAnchored] = useState<Anchored | null>(null);
  // While a note is being written the selection is gone (the textarea took
  // focus), so the popover holds its own copy.
  const [composing, setComposing] = useState<(Anchored & { kind: MarkKind }) | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    const onSelectionChange = () => setAnchored(readAnchored());
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  if (!review) {
    return null;
  }

  const closePopover = () => {
    setComposing(null);
    setNote('');
  };

  const addRedline = () => {
    if (anchored) {
      review.addMark({ kind: 'redline', ...anchored.selection, note: '' });
      window.getSelection()?.removeAllRanges();
      setAnchored(null);
    }
  };

  const submitNote = () => {
    if (composing && note.trim()) {
      review.addMark({ kind: composing.kind, ...composing.selection, note: note.trim() });
      closePopover();
      window.getSelection()?.removeAllRanges();
    }
  };

  if (composing) {
    return (
      <div
        className="fixed z-50 w-72 rounded-lg border border-border bg-popover p-2 shadow-lg"
        style={{ top: composing.top, left: composing.left }}
      >
        <textarea
          autoFocus
          data-testid="review-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          placeholder={composing.kind === 'question'
            ? t('review.askPlaceholder', 'Ask about this…')
            : t('review.commentPlaceholder', 'Add a comment…')}
          className="w-full resize-none rounded-md border border-border bg-background p-2 text-sm"
        />
        <div className="mt-1 flex justify-end gap-1 text-xs">
          <button type="button" onClick={closePopover} className="rounded-md px-2 py-1 hover:bg-accent">
            {t('review.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            data-testid="review-note-add"
            onClick={submitNote}
            className="rounded-md bg-primary px-2 py-1 text-primary-foreground"
          >
            {t('review.add', 'Add')}
          </button>
        </div>
      </div>
    );
  }

  if (!anchored) {
    return null;
  }

  const buttonClass = 'rounded-md px-2 py-1 hover:bg-accent';
  return (
    <div
      // Keeps the click from collapsing the selection before it is read.
      onMouseDown={(event) => event.preventDefault()}
      className="fixed z-50 flex gap-0.5 rounded-lg border border-border bg-popover p-1 text-xs shadow-lg"
      style={{ top: anchored.top, left: anchored.left }}
    >
      <button type="button" data-testid="review-comment" className={buttonClass} onClick={() => setComposing({ ...anchored, kind: 'comment' })}>
        {t('review.comment', 'Comment')}
      </button>
      <button type="button" data-testid="review-ask" className={buttonClass} onClick={() => setComposing({ ...anchored, kind: 'question' })}>
        {t('review.ask', 'Ask')}
      </button>
      <button type="button" data-testid="review-redline" className={buttonClass} onClick={addRedline}>
        {t('review.redline', 'Redline')}
      </button>
    </div>
  );
}
```

Add to `src/modules/review/index.ts`:

```ts
export { default as SelectionToolbar } from '@/modules/review/components/SelectionToolbar';
```

In `ChatInterface.tsx`, add `SelectionToolbar` to the review import and render `<SelectionToolbar />` as the first child inside `<ReviewContext.Provider value={review}>`.

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/modules/review/tests/selection.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/modules/review src/modules/chat/ChatInterface.tsx
git commit -m "feat(review): comment, ask and redline on selected passages"
```

---

### Task 11: Highlights

**Files:**
- Create: `src/modules/review/selection/highlightRanges.ts`, `src/modules/review/components/ReviewHighlights.tsx`
- Modify: `src/modules/review/index.ts`, `src/modules/chat/ChatInterface.tsx`, `src/index.css`
- Test: `src/modules/review/tests/highlightRanges.test.ts`

The Custom Highlight API is feature-detected. Where it is missing, `paintHighlights` does nothing and marks still work, as the spec requires.

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';

import { findQuoteRange, paintHighlights } from '@/modules/review/selection/highlightRanges';

afterEach(() => {
  document.body.innerHTML = '';
  delete (globalThis as any).Highlight;
  delete (CSS as any).highlights;
});

const mount = (html: string) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.firstElementChild as HTMLElement;
};

test('finds a quote across inline elements', () => {
  const target = mount('<div><p>keep <strong>bold</strong> words</p></div>');
  assert.equal(findQuoteRange(target, { quote: 'keep bold words' })?.toString(), 'keep bold words');
});

test('uses context to pick the right occurrence', () => {
  const target = mount('<div><p>one word then another word again</p></div>');
  const range = findQuoteRange(target, { quote: 'word', before: 'another', after: 'again' });
  assert.equal(range?.startOffset, 22);
});

test('returns null when the quote is gone', () => {
  assert.equal(findQuoteRange(mount('<div><p>text</p></div>'), { quote: 'missing' }), null);
});

test('is a no-op without API support', () => {
  mount('<div data-review-target="a@v1"><p>text</p></div>');
  assert.doesNotThrow(() => paintHighlights([{ target: 'a@v1', quote: 'text' }], []));
});

test('registers both highlight groups', () => {
  const registry = new Map<string, unknown[]>();
  (CSS as any).highlights = { set: (name: string, value: unknown[]) => registry.set(name, value), delete: (name: string) => registry.delete(name) };
  (globalThis as any).Highlight = class extends Array { constructor(...ranges: unknown[]) { super(); this.push(...ranges); } };
  mount('<div data-review-target="a@v1"><p>draft passage and discussed passage</p></div>');
  paintHighlights([{ target: 'a@v1', quote: 'draft' }], [{ target: 'a@v1', quote: 'discussed' }]);
  assert.equal((registry.get('review-draft') as unknown[]).length, 1);
  assert.equal((registry.get('review-discussed') as unknown[]).length, 1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/modules/review/tests/highlightRanges.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/modules/review/selection/highlightRanges.ts`**

```ts
import type { MarkAnchor } from '@/modules/review/types';

export type HighlightRequest = MarkAnchor & { target: string };

type CharacterPosition = { node: Text; offset: number };

/** Every non-whitespace character in `root`, with where it lives in the DOM. */
function indexCharacters(root: HTMLElement): { text: string; positions: CharacterPosition[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (
      node.parentElement?.closest('del, [data-review-chrome]')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT
    ),
  });
  let text = '';
  const positions: CharacterPosition[] = [];
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    for (let offset = 0; offset < node.data.length; offset++) {
      if (!/\s/.test(node.data[offset])) {
        text += node.data[offset];
        positions.push({ node, offset });
      }
    }
  }
  return { text, positions };
}

const squash = (text: string) => text.replace(/\s+/g, '');

/** A DOM range over the quote in `root`, using context to choose among repeats. */
export function findQuoteRange(root: HTMLElement, anchor: MarkAnchor): Range | null {
  const { text, positions } = indexCharacters(root);
  const quote = squash(anchor.quote);
  if (!quote) {
    return null;
  }
  const before = squash(anchor.before ?? '');
  const after = squash(anchor.after ?? '');

  let chosen = -1;
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
    if (chosen === -1) {
      chosen = at;
    }
    if ((before || after)
      && (!before || text.slice(0, at).endsWith(before))
      && (!after || text.slice(at + quote.length).startsWith(after))) {
      chosen = at;
      break;
    }
  }
  if (chosen === -1) {
    return null;
  }

  const start = positions[chosen];
  const end = positions[chosen + quote.length - 1];
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

function rangesFor(requests: HighlightRequest[]): Range[] {
  const ranges: Range[] = [];
  for (const request of requests) {
    const root = document.querySelector<HTMLElement>(`[data-review-target="${CSS.escape(request.target)}"]`);
    const range = root ? findQuoteRange(root, request) : null;
    if (range) {
      ranges.push(range);
    }
  }
  return ranges;
}

/** Paints draft and discussed passages without touching the rendered DOM. */
export function paintHighlights(drafts: HighlightRequest[], discussed: HighlightRequest[]): void {
  const registry = (CSS as unknown as { highlights?: { set(name: string, value: unknown): void } }).highlights;
  const HighlightClass = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!registry || !HighlightClass) {
    return;
  }
  registry.set('review-draft', new HighlightClass(...rangesFor(drafts)));
  registry.set('review-discussed', new HighlightClass(...rangesFor(discussed)));
}
```

`CSS.escape` does not exist in jsdom, so add this to `vitest.setup.ts`, after the `matchMedia` block:

```ts
// jsdom ships no `CSS.escape`, which review uses to build attribute selectors.
if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
  (globalThis as any).CSS = { ...(globalThis as any).CSS, escape: (value: string) => value.replace(/["\\\]]/g, '\\$&') };
}
```

- [ ] **Step 4: Write `src/modules/review/components/ReviewHighlights.tsx`**

```tsx
import { useEffect, useMemo } from 'react';

import { paintHighlights, type HighlightRequest } from '@/modules/review/selection/highlightRanges';
import { useReview } from '@/modules/review/state/ReviewContext';

const REPAINT_DEBOUNCE_MS = 200;

/** Repaints when marks change and when transcript rows mount or re-render. */
export default function ReviewHighlights({ container }: { container: HTMLElement | null }) {
  const review = useReview();
  const drafts: HighlightRequest[] = review?.marks ?? [];
  const discussed = useMemo<HighlightRequest[]>(() => {
    const requests: HighlightRequest[] = [];
    review?.index.discussions.forEach((list, target) => {
      list.forEach(({ quote }) => requests.push({ target, quote }));
    });
    return requests;
  }, [review?.index]);

  useEffect(() => {
    paintHighlights(drafts, discussed);
    if (!container) {
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver(() => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => paintHighlights(drafts, discussed), REPAINT_DEBOUNCE_MS);
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [container, discussed, drafts]);

  return null;
}
```

Add to `src/modules/review/index.ts`:

```ts
export { default as ReviewHighlights } from '@/modules/review/components/ReviewHighlights';
```

In `ChatInterface.tsx`, add `ReviewHighlights` to the review import and render it next to `<SelectionToolbar />`:

```tsx
<ReviewHighlights container={scrollContainerRef.current} />
```

Add to the end of `src/index.css`:

```css
::highlight(review-draft) {
  background-color: rgb(250 204 21 / 0.4);
}

::highlight(review-discussed) {
  background-color: rgb(96 165 250 / 0.25);
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/modules/review/tests/highlightRanges.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/modules/review src/modules/chat/ChatInterface.tsx src/index.css vitest.setup.ts
git commit -m "feat(review): highlight draft and discussed passages"
```

---

### Task 12: Marks tray and sending

**Files:**
- Create: `src/modules/review/components/MarksTray.tsx`, `src/modules/review/state/prepareSubmission.ts`
- Modify: `src/modules/review/index.ts`, `src/modules/chat/composer/ChatComposer.tsx`, `src/modules/chat/hooks/useChatComposerState.ts`
- Test: `src/modules/review/tests/marksTray.test.tsx`, `src/modules/review/tests/prepareSubmission.test.ts`

- [ ] **Step 1: Write the failing tests**

`prepareSubmission.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'vitest';

import { prepareSubmission } from '@/modules/review/state/prepareSubmission';

const compose = (typed: string) => `BLOCK\n${typed}`;

test('marks are composed into a normal message', () => {
  assert.deepEqual(prepareSubmission({ typed: 'hi', hasMarks: true, isQueuedResend: false, composeFeedback: compose }), {
    text: 'BLOCK\nhi', consumedMarks: true,
  });
});

test('a tray with empty text still has something to send', () => {
  assert.deepEqual(prepareSubmission({ typed: '', hasMarks: true, isQueuedResend: false, composeFeedback: compose }), {
    text: 'BLOCK\n', consumedMarks: true,
  });
});

test('a slash command is left alone and the tray keeps its marks', () => {
  assert.deepEqual(prepareSubmission({ typed: '/compact', hasMarks: true, isQueuedResend: false, composeFeedback: compose }), {
    text: '/compact', consumedMarks: false,
  });
});

test('a queued resend already holds its block', () => {
  assert.deepEqual(prepareSubmission({ typed: 'BLOCK\nhi', hasMarks: true, isQueuedResend: true, composeFeedback: compose }), {
    text: 'BLOCK\nhi', consumedMarks: false,
  });
});

test('no marks means no change', () => {
  assert.deepEqual(prepareSubmission({ typed: 'hi', hasMarks: false, isQueuedResend: false, composeFeedback: compose }), {
    text: 'hi', consumedMarks: false,
  });
});
```

`marksTray.test.tsx`:

```tsx
import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { test, vi } from 'vitest';

import MarksTray from '@/modules/review/components/MarksTray';
import { EMPTY_REVIEW_INDEX } from '@/modules/review/state/buildReviewIndex';
import { ReviewContext, type ReviewContextValue } from '@/modules/review/state/ReviewContext';

const MARK = { key: 'k1', kind: 'comment' as const, target: 'a@v1', quote: 'a passage', note: 'note' };

const show = (overrides: Partial<ReviewContextValue>) => {
  const value = { index: EMPTY_REVIEW_INDEX, marks: [], saveFailed: false, updateMark: vi.fn(), removeMark: vi.fn(), ...overrides } as unknown as ReviewContextValue;
  return { value, ...render(<ReviewContext.Provider value={value}><MarksTray /></ReviewContext.Provider>) };
};

test('renders nothing with no marks', () => {
  assert.equal(show({}).container.firstChild, null);
});

test('edits and removes a mark', () => {
  const { value } = show({ marks: [MARK] });
  fireEvent.change(screen.getByTestId('review-tray-note-k1'), { target: { value: 'changed' } });
  assert.deepEqual((value.updateMark as any).mock.calls[0], ['k1', 'changed']);
  fireEvent.click(screen.getByTestId('review-tray-remove-k1'));
  assert.deepEqual((value.removeMark as any).mock.calls[0], ['k1']);
});

test('warns when saving failed', () => {
  show({ marks: [MARK], saveFailed: true });
  assert.ok(screen.getByTestId('review-tray-save-failed'));
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/modules/review/tests/prepareSubmission.test.ts src/modules/review/tests/marksTray.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the implementation**

`src/modules/review/state/prepareSubmission.ts`:

```ts
type PrepareSubmissionInput = {
  typed: string;
  hasMarks: boolean;
  /** A queued message being flushed: its feedback block was composed when it was queued. */
  isQueuedResend: boolean;
  composeFeedback(typed: string): string;
};

/** What the composer should send, and whether doing so uses up the tray. */
export function prepareSubmission(input: PrepareSubmissionInput): { text: string; consumedMarks: boolean } {
  const { typed, hasMarks, isQueuedResend, composeFeedback } = input;
  // A block in front of a slash command would stop it being a command.
  if (!hasMarks || isQueuedResend || typed.trimStart().startsWith('/')) {
    return { text: typed, consumedMarks: false };
  }
  return { text: composeFeedback(typed), consumedMarks: true };
}
```

`src/modules/review/components/MarksTray.tsx`:

```tsx
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useReview } from '@/modules/review/state/ReviewContext';

/** Above the composer: everything that will go with the next message. */
export default function MarksTray() {
  const { t } = useTranslation('chat');
  const review = useReview();
  if (!review || review.marks.length === 0) {
    return null;
  }

  return (
    <div className="mx-auto mb-2 flex max-h-48 max-w-[54.25rem] flex-col gap-1.5 overflow-y-auto rounded-xl border border-border bg-muted/40 p-2 text-xs">
      {review.marks.map((mark) => (
        <div key={mark.key} className="flex items-start gap-2 rounded-md bg-background/70 p-2">
          <div className="min-w-0 flex-1">
            <div className="truncate italic text-muted-foreground">
              <span className="mr-1 font-mono not-italic">{t(`review.kind.${mark.kind}`, mark.kind)}</span>
              “{mark.quote}”
            </div>
            {mark.kind !== 'redline' && (
              <textarea
                data-testid={`review-tray-note-${mark.key}`}
                value={mark.note}
                rows={1}
                onChange={(event) => review.updateMark(mark.key, event.target.value)}
                className="mt-1 w-full resize-none rounded border border-border bg-background px-1.5 py-1 text-sm"
              />
            )}
          </div>
          <button
            type="button"
            data-testid={`review-tray-remove-${mark.key}`}
            aria-label={t('review.remove', 'Remove')}
            onClick={() => review.removeMark(mark.key)}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {review.saveFailed && (
        <div data-testid="review-tray-save-failed" className="px-1 text-amber-600 dark:text-amber-400">
          {t('review.marksSaveFailed', "Couldn't save these marks. They'll be lost if you reload.")}
        </div>
      )}
    </div>
  );
}
```

Add to `src/modules/review/index.ts`:

```ts
export { default as MarksTray } from '@/modules/review/components/MarksTray';
export { prepareSubmission } from '@/modules/review/state/prepareSubmission';
export type { ReviewContextValue } from '@/modules/review/state/ReviewContext';
```

- [ ] **Step 4: Show the tray**

In `src/modules/chat/composer/ChatComposer.tsx`, add `import { MarksTray } from '@/modules/review';` and render `<MarksTray />` immediately before `{!hasQuestionPanel && <div className="relative mx-auto max-w-[54.25rem]">`.

- [ ] **Step 5: Compose on send**

In `src/modules/chat/hooks/useChatComposerState.ts`:

Add the imports:

```ts
import { prepareSubmission, type ReviewContextValue } from '@/modules/review';
```

Add to `UseChatComposerStateArgs`:

```ts
  review: ReviewContextValue;
```

Add `review,` to the destructured parameters, and next to `handleSubmitRef`:

```ts
  // Read through a ref: the tray changes independently of submitMessage's other
  // dependencies, and a rebuilt submit handler would restart its debounces.
  const reviewRef = useRef(review);
  reviewRef.current = review;
```

At the top of `submitMessage`, replace the `const currentInput = …` line and the guard that follows it:

```ts
      const typedInput = queuedSubmission?.content ?? inputValueRef.current;
      const { text: currentInput, consumedMarks } = prepareSubmission({
        typed: typedInput,
        hasMarks: reviewRef.current.marks.length > 0,
        isQueuedResend: Boolean(queuedSubmission),
        composeFeedback: reviewRef.current.composeFeedback,
      });
      const currentAttachments = queuedSubmission?.attachments ?? attachedFiles;
      const previouslyUploadedAttachments = queuedSubmission?.uploadedAttachments ?? [];
      if (
        (
          !currentInput.trim()
          && currentAttachments.length === 0
          && previouslyUploadedAttachments.length === 0
        )
        || !selectedProject
      ) {
        return;
      }
```

Inside `if (isLoading) { … }`, immediately before the `await queueMessage({` call, add:

```ts
        if (consumedMarks) {
          reviewRef.current.clearMarks();
        }
```

Do the same immediately before the second `await queueMessage({` in the background-work branch, and in the normal path immediately before `sendMessage({`. The background-work `cancel` path returns before either, so a cancelled send keeps the tray.

In `submitMessage`'s two upload-failure returns nothing changes: marks are cleared only after them.

If a queue append fails, `queueMessage` restores the composer with the composed text, so the feedback block returns as editable text rather than being lost.

- [ ] **Step 6: Run the review and composer suites, then typecheck**

Run: `npx vitest run src/modules/review/tests/ src/modules/chat/tests/composerQueuedFollowUps.test.ts src/modules/chat/tests/composerDraftScoping.test.tsx src/modules/chat/tests/composerSendOverBackgroundWork.test.ts`
Expected: PASS. If a composer test renders `useChatComposerState` directly, pass it `review: { marks: [], composeFeedback: (t: string) => t, clearMarks: () => {} } as never`.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/modules/review src/modules/chat
git commit -m "feat(review): send tray marks as a feedback round with the next message"
```

---

### Task 13: Plan mode joins the conversation

**Files:**
- Create: `src/modules/review/state/planDenial.ts`
- Modify: `src/modules/review/index.ts`, `src/modules/chat/hooks/useChatComposerState.ts`, `src/modules/chat/tools/PlanDisplay.tsx`, `src/modules/chat/tools/ToolRenderer.tsx:198`, locale `chat.json` files
- Test: `src/modules/review/tests/planDenial.test.ts`, `src/modules/chat/tests/planDisplayReview.test.tsx`

- [ ] **Step 1: Write the failing tests**

`src/modules/review/tests/planDenial.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'vitest';

import { findPlanRequestToDeny } from '@/modules/review/state/planDenial';

const plan = { requestId: 'r1', toolName: 'ExitPlanMode' };
const other = { requestId: 'r2', toolName: 'Bash' };

test('a message answers a pending plan', () => {
  assert.equal(findPlanRequestToDeny({ requests: [other, plan], text: 'change it', hasAttachments: false, isQueuedResend: false })?.requestId, 'r1');
});

test('the legacy tool name counts', () => {
  assert.equal(findPlanRequestToDeny({ requests: [{ requestId: 'r3', toolName: 'exit_plan_mode' }], text: 'x', hasAttachments: false, isQueuedResend: false })?.requestId, 'r3');
});

test('slash commands, attachments, queued resends and other tools do not', () => {
  const base = { requests: [plan], text: 'x', hasAttachments: false, isQueuedResend: false };
  assert.equal(findPlanRequestToDeny({ ...base, text: '/compact' }), null);
  assert.equal(findPlanRequestToDeny({ ...base, hasAttachments: true }), null);
  assert.equal(findPlanRequestToDeny({ ...base, isQueuedResend: true }), null);
  assert.equal(findPlanRequestToDeny({ ...base, requests: [other] }), null);
});
```

`src/modules/chat/tests/planDisplayReview.test.tsx`:

```tsx
import assert from 'node:assert/strict';

import { render, screen } from '@testing-library/react';
import { test, vi } from 'vitest';

import PermissionContext from '@/modules/chat/context/PermissionContext';
import { PlanDisplay } from '@/modules/chat/tools/PlanDisplay';
import { buildReviewIndex } from '@/modules/review/state/buildReviewIndex';
import { ReviewContext, type ReviewContextValue } from '@/modules/review/state/ReviewContext';
import type { ChatMessage } from '@/shared/types';

vi.mock('@/modules/chat/transcript/reviewMarkdown', () => ({
  renderReviewMarkdown: (markdown: string) => <div data-testid="md">{markdown}</div>,
}));

const plan = (toolId: string, text: string) => ({
  type: 'assistant', content: '', timestamp: 0, isToolUse: true,
  toolName: 'ExitPlanMode', toolId, toolInput: JSON.stringify({ plan: text }),
}) as ChatMessage;

const show = (toolId: string, content: string, permission: unknown, toolResult?: unknown) => render(
  <ReviewContext.Provider value={{ index: buildReviewIndex([plan('t1', 'old words here'), plan('t2', 'new words here')]) } as ReviewContextValue}>
    <PermissionContext.Provider value={permission as never}>
      <PlanDisplay title="Plan" content={content} defaultOpen toolName="ExitPlanMode" toolId={toolId} toolResult={toolResult} />
    </PermissionContext.Provider>
  </ReviewContext.Provider>,
);

const pending = { pendingPermissionRequests: [{ requestId: 'r', toolName: 'ExitPlanMode' }], handlePermissionDecision: vi.fn() };

test('a resubmitted plan shows as v2 with its target and changes', () => {
  const { container } = show('t2', 'new words here', pending);
  assert.ok(container.querySelector('[data-review-target="plan@v2"]'));
  assert.ok(screen.getByTestId('review-toggle-changes'));
});

test('Build is the only decision button', () => {
  show('t1', 'old words here', pending);
  assert.ok(screen.getByRole('button', { name: /build/i }));
  assert.equal(screen.queryByRole('button', { name: /revise/i }), null);
});

test('a denial shows its feedback round', () => {
  const content = ':::feedback\n[m1 comment plan@v1] "old words"\nno\n:::';
  const { container } = show('t1', 'old words here', { pendingPermissionRequests: [] }, { isError: true, content });
  assert.ok(container.querySelector('#review-mark-m1'));
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/modules/review/tests/planDenial.test.ts src/modules/chat/tests/planDisplayReview.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write `src/modules/review/state/planDenial.ts`**

```ts
type PermissionRequestLike = { requestId: string; toolName?: string };

type FindPlanRequestInput<T> = {
  requests: T[];
  text: string;
  hasAttachments: boolean;
  isQueuedResend: boolean;
};

/**
 * The pending ExitPlanMode request this message should answer, if any.
 * A denial carries only text, so a message with attachments takes the normal
 * path, as does a slash command, which is an instruction to the CLI.
 */
export function findPlanRequestToDeny<T extends PermissionRequestLike>(input: FindPlanRequestInput<T>): T | null {
  const { requests, text, hasAttachments, isQueuedResend } = input;
  if (hasAttachments || isQueuedResend || text.trimStart().startsWith('/')) {
    return null;
  }
  return requests.find((request) => (
    request.toolName === 'ExitPlanMode' || request.toolName === 'exit_plan_mode'
  )) ?? null;
}
```

Add to `src/modules/review/index.ts`:

```ts
export { findPlanRequestToDeny } from '@/modules/review/state/planDenial';
```

- [ ] **Step 4: Deny from the composer**

In `useChatComposerState.ts`, add `findPlanRequestToDeny` to the review import, add `pendingPermissionRequests: PendingPermissionRequest[];` to `UseChatComposerStateArgs` and to the destructured parameters, and in `ChatInterface.tsx` pass `pendingPermissionRequests,` to `useChatComposerState`. In `submitMessage`, immediately after the empty-input guard and before the `// A turn is already in flight` comment, add:

```ts
      // A plan waiting for a decision holds the turn open, so this message must
      // answer it rather than queue behind it. Only Build approves; anything
      // said here is a request for another version. The dependency array cannot
      // name handlePermissionDecision, which is declared later in this hook.
      const planRequest = findPlanRequestToDeny({
        requests: pendingPermissionRequests,
        text: currentInput,
        hasAttachments: currentAttachments.length > 0 || previouslyUploadedAttachments.length > 0,
        isQueuedResend: Boolean(queuedSubmission),
      });
      if (planRequest) {
        sendMessage({
          type: 'chat.permission-response',
          requestId: planRequest.requestId,
          allow: false,
          message: currentInput,
        });
        setPendingPermissionRequests((previous) =>
          previous.filter((request) => request.requestId !== planRequest.requestId),
        );
        if (consumedMarks) {
          reviewRef.current.clearMarks();
        }
        recordSentMessage(typedInput);
        setInput('');
        inputValueRef.current = '';
        resetCommandMenuState();
        setIsTextareaExpanded(false);
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
        if (draftScopeRef.current) {
          writeDraftText(draftScopeRef.current, '');
        }
        return;
      }
```

Add `pendingPermissionRequests` and `setPendingPermissionRequests` to `submitMessage`'s dependency array. If a composer test renders the hook directly, also pass it `pendingPermissionRequests: []`.

- [ ] **Step 5: Update `PlanDisplay`**

In `src/modules/chat/tools/PlanDisplay.tsx`:

Replace the `MarkdownContent` import with:

```tsx
import { DocVersion, ReviewSegments, hashText, useReview } from '@/modules/review';
import { renderReviewMarkdown } from '@/modules/chat/transcript/reviewMarkdown';
```

Add to the props type (`toolId` already exists):

```ts
  /** The tool's result; a denial's message is the user's feedback on this plan. */
  toolResult?: { isError?: boolean; content?: unknown } | null;
```

Destructure `toolId` and `toolResult`, remove `handleRevise` and the `t` / `useTranslation` lines (nothing else uses them), and add after `handleBuild`:

```tsx
  const review = useReview();
  const planVersion = review?.index.planAt(toolId) ?? null;
  const denial = toolResult?.isError && typeof toolResult.content === 'string' ? toolResult.content : '';
```

Replace the `<MarkdownContent … />` element with:

```tsx
              <DocVersion
                id="plan"
                body={content}
                version={isStreaming ? null : planVersion?.version ?? 1}
                previousBody={planVersion?.previousBody ?? null}
                open={isStreaming}
                bare
                renderMarkdown={renderReviewMarkdown}
              />
```

Add this right before the `{showRawParameters && rawContent && (` line:

```tsx
            {denial && (
              <div className="mt-3 border-t border-border/40 pt-3">
                <ReviewSegments
                  content={denial}
                  messageHash={hashText(denial)}
                  isStreaming={false}
                  renderMarkdown={renderReviewMarkdown}
                />
              </div>
            )}
```

Remove the Revise `<Button>` from the footer.

`isStreaming` is `mode === 'input' && !toolResult`, which stays true for the whole time a plan waits for a decision, so with `open={isStreaming}` a waiting plan would have no target and no diff. Change `ToolRenderer.tsx` line ~196 so the plan is "streaming" only until its input has arrived, and pass the result:

```tsx
    const isStreaming = mode === 'input' && !toolResult && !contentProps.content;

    return (
      <PlanDisplay
        title={title}
        content={contentProps.content || ''}
        defaultOpen={displayConfig.defaultOpen ?? false}
        isStreaming={isStreaming}
        showRawParameters={mode === 'input' && showRawParameters}
        rawContent={rawToolInput}
        toolName={toolName}
        toolId={toolId}
        toolResult={toolResult}
      />
    );
```

- [ ] **Step 6: Remove the unused string**

```bash
for f in src/modules/i18n/locales/*/chat.json; do sed -i '' '/"userAskedRevise"/d' "$f"; done
git grep -n userAskedRevise -- src || echo clean
```

Expected: `clean`. Every locale had another key after this one, so JSON stays valid.

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run src/modules/review/tests/ src/modules/chat/tests/planDisplayReview.test.tsx`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/modules
git commit -m "feat(review): treat plans as versioned documents answered in the conversation"
```

---

### Task 14: Unprompted-use check and full verification

**Files:** Create `scripts/review-unprompted-check.md`

- [ ] **Step 1: Write the manual check**

````markdown
# Review loop: unprompted-use check

Run before release. It calls the real model, so it is not in CI.

1. Start the app, open a project and start a new Claude chat.
2. Send, without naming any UI element:

   ```text
   Write me a short plan for adding image uploads to a notes app.
   ```

   **Pass:** the reply contains a `:::doc id=… title=…` block and renders as a document card (v1).
3. Select a sentence in the document. Choose Comment and write "use object storage instead". Select another sentence and choose Redline. Both appear in the tray and the passages are highlighted.
4. Reload the page. **Pass:** both marks are still in the tray.
5. Press send with the input empty. **Pass:** the user message shows two quote cards and the tray is empty.
6. **Pass:** Claude's reply repeats the same id with `addresses=` naming both marks, and renders as v2 with changes marked and chips for m1 and m2. "Hide changes" shows the clean text.
7. **Pass:** v1 stays above, and both passages show a discussion badge.
8. Select a word in v2, choose Ask, write "why this?" and send. **Pass:** Claude answers in prose and writes no v3.
9. Switch the session to plan mode and ask for a plan. Comment on the plan and send. **Pass:** the plan card shows the feedback, and the next plan shows as v2 with changes. Press Build. **Pass:** Claude proceeds.
10. Open the session in a fresh tab. **Pass:** version numbers and badges are unchanged, even with more than 20 rows.
````

- [ ] **Step 2: Run everything**

```bash
npm run typecheck
npm run lint
npm run test:client
npm test
```

Expected: all pass.

- [ ] **Step 3: Run the manual check**

Follow `scripts/review-unprompted-check.md` using the `run` skill. Per spec decision 3, this piece is not done until step 2 and step 6 pass. If Claude does not use the block unprompted, tighten `REVIEW_INSTRUCTIONS` (Task 7) and repeat.

- [ ] **Step 4: Commit**

```bash
git add scripts/review-unprompted-check.md
git commit -m "docs(review): add the unprompted-use release check"
```
