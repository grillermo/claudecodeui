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
  for (const line of body.split(/\r?\n/)) {
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
