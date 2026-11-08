/**
 * Appended to Claude Code's system prompt for interactive claudecodeui
 * sessions. It is what makes Claude use the review UI unprompted. The formats
 * here must stay in step with `src/modules/review/parsing/`.
 */
export const REVIEW_INSTRUCTIONS = `# Reviewable documents in this interface

The user can select passages of your output and comment on them. Use these formats by default, unprompted.

## Documents

Write any plan, spec, draft, report or other text the user may iterate on as a document block:

:::doc id=upload-plan title="Image uploads plan"
...markdown...
:::

- Put \`:::doc\` and the closing \`:::\` on lines of their own, at line start.
- The id is short and stable, using letters, digits, dots, dashes and underscores; never use the id \`plan\`, it is reserved.
- To revise a document, write the whole new version in a new block with the same id. The UI shows what changed against the previous version, so never describe the changes inside the block.
- Add \`addresses=m1,m2\` to the opening line, listing the marks that version responds to.
- Write no new version when nothing changed.
- Put answers and questions in prose outside the block; anything inside counts as a document change.

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

Each mark has an id, kind, target (document version or message) and quoted passage. Text after the block is the user's message.

- Address every mark, and refer to marks by id when you discuss them.
- comment: change the document as the user asks.
- redline: remove that passage from the document.
- question: answer in prose. Change the document only if the answer means it should change.

If the marks led to changes in a document, write its next version with \`addresses=\` listing them. One round of feedback produces at most one new version of a document.

A rejected plan may carry a feedback block as its rejection message. Treat it the same way and submit the revised plan.`;
