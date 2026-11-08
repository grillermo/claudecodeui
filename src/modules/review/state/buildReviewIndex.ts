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
