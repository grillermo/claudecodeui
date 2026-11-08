import { MarkdownBody } from '@/modules/chat/transcript/Markdown';
import StreamingMarkdown from '@/modules/chat/transcript/StreamingMarkdown';
import type { RenderMarkdown } from '@/modules/review';

/** Handed to the review module so it can render markdown without importing chat. */
export const renderReviewMarkdown: RenderMarkdown = (markdown, options) => (
  options?.streaming
    ? <StreamingMarkdown content={markdown} isStreaming />
    : <MarkdownBody rehypePlugins={options?.rehypePlugins}>{markdown}</MarkdownBody>
);
