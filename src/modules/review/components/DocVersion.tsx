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
