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
