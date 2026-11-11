import { describe, expect, it } from 'vitest';

import { computeComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';

// iPhone-sized viewport, trigger sitting in the composer footer.
const phone = { width: 390, height: 844 };

describe('computeComposerMenuAnchor', () => {
  it('left-aligns to a trigger near the left edge so the menu stays on screen', () => {
    // The model button is the first control in the footer.
    const anchor = computeComposerMenuAnchor({ left: 36, right: 140, top: 780 }, phone, 320);

    expect(anchor.right).toBeUndefined();
    expect(anchor.left).toBe(36);
    expect(anchor.left! + anchor.maxWidth).toBeLessThanOrEqual(phone.width - 8);
  });

  it('right-aligns to a trigger with enough room on its left', () => {
    const anchor = computeComposerMenuAnchor({ left: 300, right: 370, top: 780 }, phone, 320);

    expect(anchor.left).toBeUndefined();
    expect(anchor.right).toBe(20);
    expect(anchor.maxWidth).toBe(320);
  });

  it('never lets a right-aligned menu run past the left edge', () => {
    const anchor = computeComposerMenuAnchor({ left: 150, right: 250, top: 780 }, phone, 320);

    expect(anchor.right).toBe(140);
    expect(phone.width - anchor.right! - anchor.maxWidth).toBeGreaterThanOrEqual(8);
  });

  it('opens above the trigger', () => {
    const anchor = computeComposerMenuAnchor({ left: 36, right: 140, top: 780 }, phone, 320);

    expect(anchor.bottom).toBe(phone.height - 780 + 8);
    expect(anchor.maxHeight).toBe(780 - 16);
  });
});
