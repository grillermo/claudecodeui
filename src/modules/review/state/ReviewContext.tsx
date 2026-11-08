import { createContext, useContext } from 'react';

import type { ReviewIndex } from '@/modules/review/state/buildReviewIndex';
import type { DraftMark } from '@/modules/review/types';

export type NewDraftMark = Omit<DraftMark, 'key'>;

export type ReviewContextValue = {
  index: ReviewIndex;
  marks: DraftMark[];
  saveFailed: boolean;
  addMark(mark: NewDraftMark): void;
  updateMark(key: string, note: string): void;
  removeMark(key: string): void;
  /** The text to send: a feedback block for the tray's marks, then what was typed. */
  composeFeedback(typed: string): string;
  clearMarks(): void;
};

export const ReviewContext = createContext<ReviewContextValue | null>(null);

export const useReview = (): ReviewContextValue | null => useContext(ReviewContext);
