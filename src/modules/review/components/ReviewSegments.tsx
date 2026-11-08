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
