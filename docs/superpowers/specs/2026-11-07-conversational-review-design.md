# Conversational review in claudecodeui

## Goal

Bring plannotator-style review into the claudecodeui conversation as native features. Review is a conversation, not a two-step approve/deny gate: the user points at specific parts of Claude's output with the mouse or cursor, comments or asks about them, and each round of feedback yields a new version in the conversation that clearly shows what changed.

## Context (verified 2026-11-07)

- claudecodeui already renders GFM, KaTeX, Mermaid and syntax highlighting (`src/modules/chat/transcript/Markdown.tsx`), and any `https:` image (`MarkdownImage.tsx`). It sets no CSP, so files.chiq.me images render today.
- It holds ExitPlanMode / AskUserQuestion in `canUseTool` and shows the plan as `PlanDisplay.tsx` (Build / Revise).
- It has no text-selection features in the transcript.
- Plannotator's relevant prior art: the annotation model (COMMENT / DELETION / GLOBAL_COMMENT, quoted anchors), the question-block grammar (`:::question`, `:::question-multi`, `:::question-text`; `QUESTION_AUTHORING_GUIDE` in `packages/core/question-block.ts`), and plan diff between versions.

## Features chosen (plannotator review, 2026-11-07)

- Selection: comment on a selection (foundation), ask about a selection, redline, diagram comments
- Feedback: server drafts
- Interactive answers: choice questions, text questions, picture choices, clickable task lists
- Plan: linked documents
- Rendering: images in messages (already works), image region comments, live HTML blocks, Graphviz
- Claude acting: comment threads
- Larger areas (file annotation, code review, …): not answered

## Decisions

1. **Feedback produces a new version with visible changes.** "As I add comments or provide feedback, a new version with the corrections appears in the conversation, clearly showing what changed." So the version diff is a core feature even though "Plan diff" wasn't ticked in the feature review.
2. **Feedback is anchored to selections.** "Provide feedback on specific things that I should select with my mouse or cursor," and "have conversations about specific parts of your work." So every comment, question and discussion is tied to a passage. The "comment threads" pick is met by passage badges and quoted messages in the main thread (decision 5), not a separate thread UI.
3. **Claude uses the UI elements by default.** "An important part of this project is that you default to using the UI elements instead of plain text, without me having to ask you." Without this, the user has to ask for a choice, a mockup or a versioned document every time; having to leave the conversation for another URL is one of the project's main drivers. In practice:
   - Choices are question blocks, never prose options.
   - Plans, specs and other documents are versioned, so revisions show what changed.
   - Visuals are embedded images, live HTML or diagrams in the message, not links to elsewhere.
   - This is delivered as instructions claudecodeui adds to every session through the Agent SDK's `systemPrompt.append` (confirmed in the SDK docs), listing each element's syntax and when to use it.
   - It is part of each piece's definition of done: a piece isn't done until Claude uses its element unprompted in a test conversation.

4. **Each version is a new message with its changes marked** (suggestions.html option A, "version=A"). Every version is its own assistant message, with insertions and deletions marked inline and a toggle to hide them; earlier versions stay where they were. The conversation reads as a story, at the cost of repeating long documents.
5. **Passage conversations live in the main thread** (option A, "threads=A"). A question or comment about a passage is an ordinary message that opens with a quote of it, and the passage gets a badge ("1 discussion") linking to those messages. No separate thread UI. Simplest, and Claude sees everything in order.

6. **Claude marks versioned documents.** Comments, questions and redlines work on any assistant message. Versions apply only to content Claude wraps in a document block with an id (e.g. `:::doc id=upload-plan`). A later block with the same id in the same session is the next version, and the UI diffs it against the previous one. This is reliable, needs no guessing, and follows from decision 3.

7. **Marks gather and go together.** Comments, questions and redlines collect above the composer and are saved on the server as drafts. They go to Claude with the user's next message as one feedback round, which produces at most one new version. This matches the "server drafts" pick.

8. **Feedback lives in the message text** (approach A). A feedback round is a normal user message containing a structured block, and the UI renders that same block. Claude's JSONL stays the only record of sent feedback. Unsent marks extend the existing `session-drafts` table, and version diffs are computed in the browser from `:::doc` blocks in the transcript. Rejected: marks in the database (a second store that drifts from the JSONL on fork, resume and edit) and hidden metadata (two representations that can disagree). Anchors point at quoted text plus surrounding context, not offsets.

9. **Plan mode joins the conversation.** The ExitPlanMode plan is a versioned document (`plan`), feedback sent while it waits becomes the deny message, and Build is the only explicit approval. The SDK requires a decision on ExitPlanMode, but this way only "go ahead" needs a button; everything else is conversation. Approved with section 3.

## Sub-projects

Each piece gets its own spec, plan and implementation, built in this order:

1. **Review loop** (this spec): selection on assistant messages; comment, ask and redline; the marks tray with server drafts; the feedback block; `:::doc` versioned documents with marked changes; passage badges; the session instructions that make Claude use them unprompted.
2. **Question blocks**: choice, text and picture questions, plus clickable task lists.
3. **Rich rendering**: live HTML blocks, Graphviz, image region comments, diagram comments.
4. **Linked documents**: project files as versioned documents.

## Design

### 1. Shared formats (approved 2026-11-07)

**Versioned document**, written by Claude:

```markdown
:::doc id=upload-plan title="Image uploads plan" addresses=m1,m2
…markdown…
:::
```

- The first block with an `id` in a session is v1. Each later block with the same id is the next version, rendered as a new message with insertions and deletions marked against the previous version, plus a "hide changes" toggle.
- `addresses=` lists the marks the version responds to. They render as change chips linking back to each mark.
- Answers to questions go in prose outside the block, so they never count as document changes.
- The diff compares paragraphs and list items first, then words within changed ones.

**Feedback round**, written by the UI into the user's message:

```markdown
:::feedback
[m1 comment upload-plan@v1] "Store uploads in the project's .uploads/ folder"
Use files.chiq.me instead, these need to open on my phone.

[m2 redline upload-plan@v1] "Resize images on the client before upload to keep the transcript light."

[m3 question msg:7f3a] "up to 5 MB"
Why 5 MB? iPad screenshots are bigger.
:::
Free text typed in the composer follows the block.
```

- Each mark has an id, a kind (`comment` | `question` | `redline`), a target (`<doc-id>@v<N>` or `msg:<short id>`) and a quoted passage.
- When a quote occurs more than once in its target, the UI adds surrounding context to the anchor (`… "quote" …`). Otherwise the quote alone is enough.
- Mark ids count up across the session (m1, m2, …), so Claude can refer to them and `addresses=` stays unique.
- Passage badges come from scanning later feedback blocks for marks that point back at a passage. Nothing extra is stored.
- Outside claudecodeui both blocks stay readable markdown.
- A mark may target any version, not only the latest; its target names which one.
- `msg:<short id>` is the first 8 characters of the message's `transcriptAnchorId` (Claude's stable row id, already used for edit and fork).

### 2. Frontend (approved 2026-11-08)

A new feature module, `src/modules/review/`, used by chat only through its `index.ts`.

- **Rendering.** `remark-directive` and a small plugin added to `src/modules/chat/transcript/Markdown.tsx` recognise `:::doc` and `:::feedback`. A malformed or unknown block renders as plain markdown.
  - `DocVersion` shows the version header (title · vN · K changes), change chips from `addresses=`, and the body with changes marked against the previous version, with a hide-changes toggle. v1 is a plain document card.
  - `FeedbackRound` shows the marks as quote cards, colour-coded by kind, each linking to its passage.
- **Transcript index.** `useReviewIndex(messages)` derives each document's ordered versions, the next free mark id, and the passages with later discussions (badges). It recomputes when messages change and stores nothing.
- **Selection.** `SelectionToolbar` appears on a text selection inside an assistant message, offering Comment / Ask / Redline. Comment and Ask open a popover; Redline adds the mark at once. All three gather in the tray (decision 7); Ask is not sent on its own. The target is the doc id and version for selections inside a `:::doc`, otherwise `msg:` from `transcriptAnchorId`.
- **Highlights.** Draft marks and badged passages are painted with the CSS Custom Highlight API, never by mutating the rendered DOM. Without API support, marks work but aren't painted. Check browser support before implementation.
- **Composer.** `MarksTray` above the input: chips can be edited or removed, and are persisted through the session-drafts API extended with a `marks` field. On send, marks are serialised into a `:::feedback` block ahead of the typed text and the tray clears. Sends during a running turn use the existing queued-message path.
- **Diff.** `diff` (jsdiff): split markdown into blocks (paragraphs, list items, headings, code fences), match blocks, word-diff changed blocks, line-diff code fences.

### 3. Server, session instructions and plan mode (approved 2026-11-08)

- **Session instructions.** In `server/modules/providers/list/claude/claude-runtime.provider.ts` (`mapCliOptionsToSDK`), set `systemPrompt: { type: 'preset', preset: 'claude_code', append: REVIEW_INSTRUCTIONS }` for interactive sessions. Confirmed in the Agent SDK docs (`code.claude.com/docs/en/agent-sdk/modifying-system-prompts`). The instructions, around 300 words:
  - Write plans, specs, drafts and anything the user may iterate on as `:::doc id=… title=…`; revise by repeating the id with `addresses=`.
  - Read `:::feedback` marks: address each one, treat a redline as removal, answer questions in prose, refer to marks by id.
  - Don't write a new version when nothing in the document changed.
  - Unattended runs (agent API, commit messages) get no instructions. In this piece only the Claude provider gets them; other providers still render the blocks.
- **Drafts storage.** Add a `marks` JSON column to `session-drafts`, via a migration following the database module's pattern. The drafts route reads and writes it with the text. An unparseable value counts as no marks.
- **Plan mode.** The plan in an ExitPlanMode request renders as a `DocVersion` with the reserved id `plan` (the session instructions tell Claude never to use it). `useReviewIndex` reads these versions from ExitPlanMode tool inputs, not from message text, so resubmissions show as v2, v3 with changes marked. Sending marks or any message while the request is pending resolves it as deny, with the message text (including the `:::feedback` block) as the deny message. Build remains the single explicit allow; Revise is removed.

### 4. Edge cases and testing (approved 2026-11-08)

**Edge cases**

- **Malformed blocks.** An unclosed `:::doc`, a missing `id` or a garbled mark line renders as plain markdown, with a small "couldn't read this block" note. Nothing throws; the rest of the message renders.
- **A version with no earlier one in the transcript** (e.g. the earlier one is on a forked-away branch) renders as v1. Diffs always compare against the previous version present in the transcript.
- **A quote no longer found** (passage edited away, message truncated by an edit). The mark still sends with its quote; its card says "passage no longer in the conversation", and no badge is shown.
- **Streaming.** A `:::doc` still being written renders as a plain document card; the diff appears when the closing `:::` arrives.
- **Draft save failure.** Marks stay in the tray in memory with a warning. A reload loses only unsaved marks, as with composer text today.
- **Large documents.** Above about 2,000 blocks the diff falls back to whole-block changes, with no word-level marking.

**Testing** (vitest on the client, `node --test` on the server)

- Parser and serialiser: `:::doc` / `:::feedback` round-trips, malformed input, a quote that occurs more than once.
- `useReviewIndex`: version ordering (including ExitPlanMode plans), the mark id counter, badge derivation.
- Diff: edited, added, deleted and moved list items; code fences.
- Components: selection → tray → send yields the exact feedback block; the hide-changes toggle; plan-mode feedback becomes the deny message.
- Server: the `marks` migration and drafts round-trip; `systemPrompt.append` present on interactive runs, absent on unattended ones.
- Unprompted use (decision 3's definition of done): a scripted real session asks for a plan without naming any element and checks that Claude writes a `:::doc`; it then sends a feedback block and checks for v2 with `addresses=`. Run manually before release, not in CI, because it calls the real model.

## Out of scope for this piece

- Question blocks, live HTML, Graphviz, image region and diagram comments, linked documents: later pieces (see Sub-projects).
- Session instructions for Codex, Cursor and OpenCode.
- File annotation, code review and the other larger areas (left unanswered in the feature review).
