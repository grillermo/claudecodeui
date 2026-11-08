import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { test, vi } from 'vitest';

import MarksTray from '@/modules/review/components/MarksTray';
import { EMPTY_REVIEW_INDEX } from '@/modules/review/state/buildReviewIndex';
import { ReviewContext, type ReviewContextValue } from '@/modules/review/state/ReviewContext';

const MARK = { key: 'k1', kind: 'comment' as const, target: 'a@v1', quote: 'a passage', note: 'note' };

const show = (overrides: Partial<ReviewContextValue>) => {
  const value = { index: EMPTY_REVIEW_INDEX, marks: [], saveFailed: false, updateMark: vi.fn(), removeMark: vi.fn(), ...overrides } as unknown as ReviewContextValue;
  return { value, ...render(<ReviewContext.Provider value={value}><MarksTray /></ReviewContext.Provider>) };
};

test('renders nothing with no marks', () => {
  assert.equal(show({}).container.firstChild, null);
});

test('edits and removes a mark', () => {
  const { value } = show({ marks: [MARK] });
  fireEvent.change(screen.getByTestId('review-tray-note-k1'), { target: { value: 'changed' } });
  assert.deepEqual((value.updateMark as any).mock.calls[0], ['k1', 'changed']);
  fireEvent.click(screen.getByTestId('review-tray-remove-k1'));
  assert.deepEqual((value.removeMark as any).mock.calls[0], ['k1']);
});

test('warns when saving failed', () => {
  show({ marks: [MARK], saveFailed: true });
  assert.ok(screen.getByTestId('review-tray-save-failed'));
});
