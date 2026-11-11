import { useCallback, useEffect, useRef, useState } from 'react';

import type { ComposerMenuAnchor } from '@/shared/types';


const VIEWPORT_MARGIN = 8;
const MENU_GAP = 8;

/**
 * Places a composer popover above its trigger.
 *
 * It right-aligns to the trigger and grows leftward. When the trigger sits too
 * close to the left edge for that (on a phone the model button is the first
 * thing in the footer), it left-aligns to the trigger and grows rightward
 * instead, so the menu never runs off-screen. Anchoring by edge offsets rather
 * than `top` lets the menu grow upward without measuring itself first.
 */
export function computeComposerMenuAnchor(
  rect: Pick<DOMRect, 'left' | 'right' | 'top'>,
  viewport: { width: number; height: number },
  preferredWidth: number,
): ComposerMenuAnchor {
  const bottom = viewport.height - rect.top + MENU_GAP;
  const maxHeight = Math.max(160, rect.top - MENU_GAP - VIEWPORT_MARGIN);

  const right = Math.max(VIEWPORT_MARGIN, viewport.width - rect.right);
  const roomGrowingLeft = viewport.width - right - VIEWPORT_MARGIN;
  const left = Math.max(VIEWPORT_MARGIN, rect.left);
  const roomGrowingRight = viewport.width - left - VIEWPORT_MARGIN;

  if (roomGrowingLeft >= preferredWidth || roomGrowingLeft >= roomGrowingRight) {
    return { right, bottom, maxHeight, maxWidth: Math.min(preferredWidth, roomGrowingLeft) };
  }
  return { left, bottom, maxHeight, maxWidth: Math.min(preferredWidth, roomGrowingRight) };
}

/** Opens, positions and dismisses a composer popover; placement comes from computeComposerMenuAnchor. */
export function useComposerMenuAnchor(
  isOpen: boolean,
  onClose: () => void,
  preferredWidth = 320,
) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<ComposerMenuAnchor | null>(null);

  const updateAnchor = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    setAnchor(computeComposerMenuAnchor(
      rect,
      { width: window.innerWidth, height: window.innerHeight },
      preferredWidth,
    ));
  }, [preferredWidth]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        onClose();
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onClose();
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', updateAnchor);
    window.addEventListener('scroll', updateAnchor, true);
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    updateAnchor();

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', updateAnchor);
      window.removeEventListener('scroll', updateAnchor, true);
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [isOpen, onClose, updateAnchor]);

  return { triggerRef, menuRef, anchor, updateAnchor };
}
