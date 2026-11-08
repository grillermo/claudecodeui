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
