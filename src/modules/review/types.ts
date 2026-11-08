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
